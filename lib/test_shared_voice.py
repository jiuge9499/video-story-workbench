"""Failure and resume contracts at the workbench/shared-service boundary."""
import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError

import speech


class FakeClient:
    def __init__(self, effects=()):
        self.calls = []
        self.effects = list(effects)

    def synthesize(self, **kwargs):
        self.calls.append(kwargs)
        if self.effects:
            effect = self.effects.pop(0)
            if isinstance(effect, Exception):
                raise effect
            return effect
        return {'id': 'a' * 32, 'warnings': []}


class SharedVoiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config = {'cacheDir': self.temp.name, 'projectId': 'test-project',
                       'voice': '男播客', 'speed': 1.0}

    def generate(self, client, text='孩子放学回家。'):
        return speech.synthesize_scene(client, text, Path(self.temp.name)/'voice.mp3', self.config, wait=lambda _: None)

    def test_traditional_transcript_keeps_all_character_timestamps(self):
        source = '是课上课下谁为主。小学老师是保姆式的，一个知识点讲三五遍，'
        recognized = '是課上課下誰為主小學老師是保姆式的一個知識點講三五遍'
        authored = [(m.start(), m.group()) for m in re.finditer(r'[^\W_]', source)]
        times = [i * .2 for i in range(len(recognized))]
        timeline, known, coverage = speech.match_character_times(authored, list(recognized), times)
        self.assertEqual(coverage, 1)
        self.assertEqual(timeline, times)
        self.assertEqual(len(known), len(authored))
        self.assertEqual(source[authored[8][0]], '小')

    def test_traditional_authored_text_and_mixed_symbols(self):
        self.assertEqual(speech.simplified('課上學習 AI 2.0，😀'), '课上学习 AI 2.0，😀')

    def test_real_transcript_mismatch_still_stops_production(self):
        source = '小学老师一个知识点讲三五遍'
        authored = list(enumerate(source))
        with self.assertRaisesRegex(RuntimeError, '需复核配音'):
            speech.match_character_times(authored, list('完全无关的声音'), list(range(7)))

    def test_equivalent_number_notation_keeps_monotonic_timestamps(self):
        source = '二中三中加起来四千一百来个一百个孩子里六个'
        heard = '二宗三宗加起来4100来个100个孩子里6个'
        timeline, known, coverage = speech.match_character_times(
            list(enumerate(source)), list(heard), list(range(len(heard))))
        self.assertAlmostEqual(coverage, (len(source)-2)/len(source))
        measured = [timeline[i] for i in known]
        self.assertEqual(measured, sorted(measured))
        self.assertEqual(timeline[source.index('四')], heard.index('4'))
        self.assertEqual(timeline[-1], len(heard)-1)

    def test_different_numbers_are_not_treated_as_equal(self):
        with self.assertRaisesRegex(RuntimeError, '需复核配音'):
            speech.match_character_times(list(enumerate('四千一百')), list('4101'), list(range(4)))

    def test_integer_units_and_zeroes(self):
        from chinese_alignment import integer_value
        for text, value in [('十',10), ('一百零六',106), ('两千',2000),
                            ('一亿四千万',140000000), ('二零二六',2026)]:
            self.assertEqual(integer_value(text), value)

    def test_timeout_and_connection_loss_resume_identical_request(self):
        client = FakeClient([TimeoutError('任务仍在执行'), URLError('connection lost')])
        self.generate(client)
        self.generate(client)
        self.assertEqual(len({c['idempotency_key'] for c in client.calls}), 1)
        self.assertTrue(all(c['voice'] == '男播客' and c['speed'] == 1 for c in client.calls))

    def test_terminal_failure_rotates_key_and_has_bounded_retry(self):
        error = RuntimeError('配音任务 ' + 'b'*32 + ' 失败：模型错误')
        client = FakeClient([error, error])
        with self.assertRaisesRegex(RuntimeError, '模型错误'):
            self.generate(client)
        self.assertEqual(len(client.calls), 2)
        self.assertNotEqual(client.calls[0]['idempotency_key'], client.calls[1]['idempotency_key'])
        self.generate(client)
        self.assertEqual(len({c['idempotency_key'] for c in client.calls}), 3)

    def test_content_and_speed_changes_get_new_keys(self):
        client = FakeClient()
        self.generate(client)
        self.generate(client, '先写作业清单。')
        self.config['speed'] = 1.2
        self.generate(client)
        self.assertEqual(len({c['idempotency_key'] for c in client.calls}), 3)

    def test_custom_clone_is_forwarded_to_shared_service(self):
        self.config['voice'] = 'local:test-female-clone'
        client = FakeClient()
        self.generate(client)
        self.assertEqual(client.calls[0]['voice'], 'local:test-female-clone')

    def test_markdown_is_not_sent_to_voice_or_reused_from_marked_audio(self):
        client = FakeClient()
        self.generate(client, '**初二成绩下滑，不是孩子变懒了**')
        self.generate(client, '初二成绩下滑，不是孩子变懒了')
        self.assertEqual(client.calls[0]['text'], '初二成绩下滑，不是孩子变懒了')
        self.assertEqual(client.calls[0]['idempotency_key'], client.calls[1]['idempotency_key'])
        self.assertEqual(speech.plain_narration('2 ** 3，A*B，**好**'), '2 ** 3，A*B，好')

    def test_validation_failure_is_not_retried(self):
        client = FakeClient([RuntimeError('相同 idempotency_key 已用于不同内容')])
        with self.assertRaises(RuntimeError):
            self.generate(client)
        self.assertEqual(len(client.calls), 1)

    def test_pronunciation_warnings_remain_in_result_and_record(self):
        warnings = [{'part': 1, 'differences': [{'want': '清单', 'got': '轻松'}]}]
        client = FakeClient([{'id': 'c'*32, 'warnings': warnings}])
        self.assertEqual(self.generate(client)['warnings'], warnings)
        record = json.loads(next(Path(self.temp.name).glob('*.json')).read_text())
        self.assertEqual(record['warnings'], warnings)

    def test_mismatching_final_script_stops_before_service(self):
        file = Path(self.temp.name)/'input.json'
        file.write_text(json.dumps({**self.config, 'script':'确定的最终文案', 'scenes':[{'id':'1','text':'过期分镜'}]}))
        with patch.object(speech, 'load_client') as loader:
            with self.assertRaisesRegex(ValueError, '不一致'):
                speech.main(file)
            loader.assert_not_called()

    def test_completed_audio_is_preserved_on_review_and_speed_is_not_applied_twice(self):
        root = Path(self.temp.name)
        tone = root/'source.mp3'
        subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i',
                        'sine=frequency=300:duration=1','-q:a','4',str(tone)], check=True)
        warnings = [{'part':1,'differences':[{'want':'回家','got':'回答'}]}]

        class AudioClient:
            def synthesize(self, **kwargs):
                shutil.copyfile(tone, kwargs['output'])
                self.speed = kwargs['speed']
                return {'id':'d'*32,'warnings':warnings}

        def align(source, audio, dest, index, tools):
            words = [{'text':'孩子','start':0,'end':.5}, {'text':'回家','start':.5,'end':1}]
            speech.atomic_json(dest/f'boundaries-{index}.json', {'words':words,'coverage':1})
            return words

        client = AudioClient()
        file = root/'input.json'
        file.write_text(json.dumps({**self.config,'speed':1.2,'script':'孩子回家。',
                                   'scenes':[{'id':'1','text':'孩子回家。'}]}))
        with patch.object(speech,'load_client',return_value=client), patch.object(speech,'align_words',side_effect=align):
            self.assertEqual(speech.main(file),2)
        report = json.loads((root/'speech.json').read_text())
        self.assertEqual(report['status'],'review')
        self.assertEqual(report['warnings'][0]['differences'],warnings[0]['differences'])
        self.assertTrue((root/'narration.wav').stat().st_size>0)
        self.assertEqual(client.speed,1.2)
        self.assertAlmostEqual(report['duration'],1,delta=.08)


if __name__ == '__main__':
    unittest.main()

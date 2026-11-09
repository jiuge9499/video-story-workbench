import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const VOICE_CLIENT=process.env.STORY_VOICE_CLIENT||path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../ai-wenzi-workflow-main/src/mine/voice_service/client.py');
export const SHARED_VOICE='男播客';
export const SPEECH_PROVIDER='local-qwen-voice-v1';
export const EDGE_SPEECH_PROVIDER='edge-tts-v1';
export const providerForVoice=voice=>/^[a-z]{2}-[A-Z]{2}-.+Neural$/.test(voice||'')?EDGE_SPEECH_PROVIDER:SPEECH_PROVIDER;
export const SPEECH_ALIGNMENT='shared-whisper-chars-v1';

export function speechBlocked(p){
  return !!p.speechIssue || p.speech?.status==='review' || !!p.speech?.warnings?.length;
}
export function assertSpeechApproved(p){
  if(speechBlocked(p))throw Error(p.speechIssue?.message||'配音有未解决的读音提醒，已暂停合成和发布素材导出');
  if(![SPEECH_PROVIDER,EDGE_SPEECH_PROVIDER].includes(p.speech?.provider)||p.speech?.status!=='ready'||(p.voice&&p.speech.provider!==providerForVoice(p.voice)))
    throw Error('请先为当前音色生成并检查配音');
}

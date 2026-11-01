// Shared by new-project defaults, storyboard prompts, and every image request.
export const UNIFORM_VERSION='nanning-autumn-v1';
export const UNIFORM_REFERENCE='shared/characters/nanning/student-boy-v1.png';
export const UNIFORM_DESCRIPTION='所有学生统一穿已确认的南宁秋季运动校服：浅蓝衣身、藏青插肩长袖、藏青前拉链、浅蓝与藏青条纹棒球领及袖口下摆、袖部浅蓝横条、左胸盾形图形徽章（无可读字）、藏青运动长裤配浅蓝侧条、白色运动鞋。不得改成西装、领带或白衬衫校服。';
export const DEFAULT_STYLE=`日系校园动漫插画，细腻线条，柔和自然光，统一人物发型。${UNIFORM_DESCRIPTION}横屏16:9，无字幕、无水印、无可读文字。`;
export function imageReferences(project,sceneId){
  const scene=project.scenes.find(s=>s.id!==sceneId&&s.image&&s.uniformVersion===UNIFORM_VERSION);
  return [UNIFORM_REFERENCE,...(scene?[scene.image]:[])];
}

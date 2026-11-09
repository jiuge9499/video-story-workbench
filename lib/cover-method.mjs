import {readMethodFile,readCharacterExpressionMethod} from './production-method.mjs';
export const COVER_LAYOUT_VERSION=6;
export const readCoverMethod=()=>readMethodFile('cover');
export function coverPrompt(p,copy,target){
 return `用户授权生成完整的短视频竖版首图。仅使用内置image_gen，禁止代码绘图替代、付费接口、子代理或发布。严格3:4，建议1080×1440。参考图仅用于沿用本作品人物身份与画风，不照搬旧封面构图。\n${readCoverMethod()}\n完整口播：${p.script}\n主标题（逐字准确）：${copy.coverTitle}\n互补看点：${copy.coverHook||'根据实际内容选择一个具体做法，最多12字'}\n主风格：${copy.coverStyle||'按内容语义依照方法选择'}。\n${p.visualStyle==='realistic-handdrawn'?'本人照片用于锁定老师身份，分镜参考用于锁定细钢笔与淡彩画法；标题可采用粗体笔刷，与人物手绘质感统一。老师不得变成动漫大眼、照片贴脸或其他人物。':''}\n人物表情按本视频主题选择：${readCharacterExpressionMethod()}\n生成完整成图，文字、人物、道具统一设计。不留大片空白，不再后贴栏目和标题。不要生成无字底图。成图保存为真实PNG并复制到 ${target}；只操作当前任务目录。内置工具不可用则明确失败。`;
}

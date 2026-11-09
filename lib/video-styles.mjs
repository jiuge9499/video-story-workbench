import {DEFAULT_STYLE,UNIFORM_DESCRIPTION} from './costume.mjs';
export const REALISTIC_STYLE='realistic-handdrawn';
export const REALISTIC_VERSION=1;
export const isRealistic=p=>p.visualStyle===REALISTIC_STYLE;
export const realisticReference='shared/styles/realistic-handdrawn-v1.png';
export const teacherReferences=['shared/characters/teacher/portrait-pink-v1.jpg','shared/characters/teacher/portrait-burgundy-v1.jpg'];
const REALISTIC_PROMPT='写实手绘图解：米白纸底、细黑钢笔线条、轻柔铅笔排线、少量灰粉淡彩与青绿赭棕强调。人物写实比例，脸部轻排线，不做动漫、大眼或照片贴头。女老师固定参照本人照片：黑色长直发、轻薄刘海、按情节自然变化的表情、粉色粗花呢外套及黑色内搭，保持五官、年龄感和身份辨识度。围绕教学、个别辅导、教研和机构运营安排真实动作；老师经常作为讲解者或参与者出现，按内容搭配学生、家长或同事。用场景、工具、无字关系图解释含义，避免每镜都套固定头像加卡片。横屏16:9，无标题、字幕、可读文字、Logo或水印，底部留给原版字幕。';
export function realisticReferences(p,sceneId){
 const previous=p.scenes.find(s=>s.id!==sceneId&&s.image&&s.imageStyle===REALISTIC_STYLE&&s.imageStyleVersion===REALISTIC_VERSION);
 return [...teacherReferences,realisticReference,...(previous?[previous.image]:[])];
}
export function realisticScenePrompt(p,s,target){
 return `用户已授权视频工作台生成一张写实手绘图解分镜。仅使用内置image_gen，禁止代码绘图替代、外部付费API、子代理、发布和消息工具。横屏16:9。${p.opening?.enabled!==false&&p.scenes[0]?.id===s.id?'本镜是B5片头：右上区域（横向46%至95%、纵向15%至55%）会叠加原版大标题，必须预留为无人物、无人脸、无关键手势的浅色墙面或空白白板。把老师的头脸放在画面左侧18%至35%区域，其余人物脸也须避开标题区域；保持自然场景，不能缩小所有人物或改变原版标题。':''}风格基准：${REALISTIC_PROMPT}。补充风格：${p.style}。本镜旁白：${s.text}。辅助画面：${s.prompt||s.text}。前两张附图是同一位老师的本人照片，仅用于锁定五官比例、年龄感、黑色长直发和轻薄刘海；第三张附图是已确认手绘风格与服装基准，只参考线条、淡彩、纸感和角色，不复制构图、标题或任何文字。若有第四张图，仅用于同片场景与人物连续性。以本人照片为身份依据，把整个人物和场景统一画成细钢笔与轻铅笔排线，禁止照片抠图、照片脸贴到手绘身体、漫画大眼和改变年龄。老师统一穿粉色粗花呢外套、黑色内搭，按叙事自然讲课、辅导、教研或与家长沟通，人物手部自然。老师为常驻主角，按语义变化姿态、景别和构图，细节镜头可只表现她的手或工具；不照搬合照或固定头像。家长、成年同事和学生按需要出现，不把他们画成老师的复制脸。若出现学生，服装要求：${UNIFORM_DESCRIPTION}米白纸底、细黑线条，少量灰粉与青绿赭棕，主体清楚，脸部不做粗重排线，图解只用无字图形和关系箭头。不要绘制标题、流程标签、字幕、字符、Logo或水印；原版流程会自动叠加片头和底部字幕。脸与关键手势远离边缘和底部字幕区。以上规则优先于旧分镜冲突描述。生成后把真实PNG复制到 ${target}，只操作当前目录内输出。工具不可用则明确失败，不得用旧图冒充。`;
}
export const ANIME_STYLE='warm-anime';
export const isAnime=p=>p.visualStyle===ANIME_STYLE;
export const animeReference='shared/styles/warm-anime-characters-v1.png';
const ANIME_PROMPT='暖彩漫画教育插画：清晰深棕轮廓、精细发束、温和赛璐璐明暗，奶油白、杏橙、珊瑚红、薄荷绿的油彩刷痕背景。学生固定为蓝眼睛、金色双丸子长发女生，穿已确认南宁秋季浅蓝藏青运动校服；家长固定为棕色自然卷短发、绿色针织开衫、米白上衣的成年女性，空手交流、不抱书或文件夹；女老师固定为深色低马尾、细框眼镜、藏蓝西装与白衬衫，可持课本和白板笔。按剧情需要选择角色，不要求三人每镜同框，保持年龄与身份区别。横屏16:9，无字幕、水印或可读文字。';
export const EDUCATION_STYLE='education-cards';
export const isEducation=p=>p.visualStyle===EDUCATION_STYLE;
export const STYLE_PRESETS=[
 {id:'story',name:'故事插画',description:'人物与场景叙事，适合观点、故事和家长共鸣。',tags:'校园插画 · 沉浸运镜',prompt:DEFAULT_STYLE,motion:'push',image:'/assets/styles/story.jpg'},
 {id:ANIME_STYLE,name:'暖彩漫画',description:'金发校服学生、亲切家长与女老师，沿用故事插画的视频效果。',tags:'暖彩漫画 · 原版运镜',prompt:ANIME_PROMPT,motion:'push',image:'/assets/styles/warm-anime.jpg',preview:'/assets/styles/warm-anime.mp4'},
 {id:REALISTIC_STYLE,name:'写实手绘图解',description:'以老师本人照片固定形象，用写实手绘场景讲教学与机构运营，沿用原版视频流程。',tags:'本人形象 · 钢笔淡彩 · 原版运镜',prompt:REALISTIC_PROMPT,motion:'push',image:'/assets/styles/realistic-handdrawn.jpg',preview:'/assets/styles/realistic-handdrawn.mp4'},
 {id:EDUCATION_STYLE,name:'教育图解',description:'图形、图标与人物讲清含义，底部字幕承接口播。',tags:'视觉讲解 · 底部字幕',prompt:'清爽教育图解插画，米白底、青蓝强调、深蓝轮廓、少量暖黄色。每镜用图形、图标、时间轴、对比关系或自然的家长与学龄孩子动作解释旁白含义。视觉主体占据主要画面，避免把图解缩在角落或用整段文字复述旁白。人物按需出现，不使用小龙、吉祥物、低幼卡通、Logo、品牌名或陪练提示。横屏16:9，无字幕、无水印、无可读文字。',motion:'still',image:'/assets/styles/education-diagram-v3.jpg',preview:'/assets/styles/education-diagram-v3.mp4'}
];
export function stylePreset(id){return STYLE_PRESETS.find(x=>x.id===id);}
export const educationReference='shared/styles/education-diagram-reference-v3.png';
export function educationReferences(p,sceneId){
 const previous=p.scenes.find(s=>s.id!==sceneId&&s.image&&s.imageStyle===EDUCATION_STYLE&&s.imageStyleVersion===3);
 return [educationReference,...(previous?[previous.image]:[])];
}

export function animeReferences(p,sceneId){
 const previous=p.scenes.find(s=>s.id!==sceneId&&s.image&&s.imageStyle===ANIME_STYLE&&s.imageStyleVersion===1);
 return [animeReference,...(previous?[previous.image]:[])];
}

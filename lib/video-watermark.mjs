// Shared by every video style; apply during composition, not image generation.
export const VIDEO_WATERMARK = Object.freeze({text:'跃龙教育',version:1});
export const watermarkCSS = '.video-watermark{z-index:10;pointer-events:none;display:flex;align-items:flex-start;justify-content:flex-start;padding:40px 48px}.video-watermark span{font-family:Chinese,sans-serif;font-size:32px;font-weight:600;line-height:1.4;letter-spacing:2px;white-space:nowrap;color:#fff;background:#102138b3;padding:7px 12px;border-radius:6px}';
export function watermarkHTML(duration,track){
  return `<div id="video-watermark" class="clip video-watermark" data-start="0" data-duration="${duration}" data-track-index="${track}"><span>${VIDEO_WATERMARK.text}</span></div>`;
}

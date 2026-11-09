import {readProductionMethod} from './production-method.mjs';
// Formatting controls are not spoken text. Keep the words and literal math symbols.
export const plainNarration = text => String(text).replace(new RegExp(readProductionMethod().narration.emphasisPattern,'g'), '$2');

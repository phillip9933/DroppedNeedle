import { registerPlugin } from '@capacitor/core';
import type { LanguageChoice } from '../i18n';

export type AndroidLanguage = { choice: LanguageChoice; effective: 'en' | 'ja' };
export const androidAppearance = registerPlugin<{
	setBackground(options: { color: string }): Promise<void>;
	getLanguage(): Promise<AndroidLanguage>;
	setLanguage(options: { choice: LanguageChoice }): Promise<AndroidLanguage>;
}>('DNAppearance');

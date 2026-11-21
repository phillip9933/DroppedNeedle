import { mount } from 'svelte';
import App from './App.svelte';
import { applyTheme, restoreTheme } from './lib/appearance/theme';
import { applyInterface } from './lib/appearance/interface';
import { installChoiceDismissal } from './lib/controls/inlineChoices';
import { applyLanguage } from './lib/i18n';
import './app.css';

applyLanguage();
installChoiceDismissal();
applyTheme(restoreTheme());
applyInterface();
mount(App, { target: document.getElementById('app')! });

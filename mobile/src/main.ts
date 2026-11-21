import { mount } from 'svelte';
import App from './App.svelte';
import { applyTheme, restoreTheme } from './lib/appearance/theme';
import { applyInterface } from './lib/appearance/interface';
import { installChoiceDismissal } from './lib/controls/inlineChoices';
import './app.css';

installChoiceDismissal();
applyTheme(restoreTheme());
applyInterface();
mount(App, { target: document.getElementById('app')! });

import { mount } from 'svelte';
import App from './App.svelte';
import { applyTheme, restoreTheme } from './lib/appearance/theme';
import { applyInterface } from './lib/appearance/interface';
import './app.css';

applyTheme(restoreTheme());
applyInterface();
mount(App, { target: document.getElementById('app')! });

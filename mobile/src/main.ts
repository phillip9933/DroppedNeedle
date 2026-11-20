import { mount } from 'svelte';
import App from './App.svelte';
import { applyTheme, restoreTheme } from './lib/appearance/theme';
import './app.css';

applyTheme(restoreTheme());
mount(App, { target: document.getElementById('app')! });

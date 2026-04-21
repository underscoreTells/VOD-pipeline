import { mount } from 'svelte';
import App from './App.svelte';
import './lib/app.css';
import { initTheme } from './lib/state/theme.svelte';

initTheme();

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;

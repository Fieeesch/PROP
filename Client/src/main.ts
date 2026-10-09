import { createApp } from 'vue';
import App from './App.vue';
import { loadRendererBackends } from './config/rendererBackends';
import './styles.css';

async function bootstrap() {
  try {
    await loadRendererBackends();
    createApp(App).mount('#app');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
    document.querySelector('#app')!.textContent = `Renderer-Konfiguration ist ungültig: ${message}`;
  }
}

void bootstrap();

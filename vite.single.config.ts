// 單一 HTML 檔打包：所有程式與樣式內嵌，可離線直接以瀏覽器開啟
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: { outDir: 'release', emptyOutDir: true, chunkSizeWarningLimit: 5000 },
});

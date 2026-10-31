import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [cloudflare()],
	server: { port: 5174 }, // 5173 is used by PopChoice, so both frontends can run at the same time
});

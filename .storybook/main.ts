import type { StorybookConfig } from '@storybook/react-vite';
import type { PluginOption } from 'vite';

// Excludes plugins whose Vite plugin name starts with any of the given prefixes.
// - react-router: not usable outside the app's own React Router build.
// - vite-plugin-pwa: pins its output to build/client (see vite.config.ts) to
//   work around React Router's per-environment outDir resolution; inheriting
//   that into the Storybook build would write sw.js/workbox files into the
//   app's build/client instead of storybook-static, and Storybook doesn't
//   need a manifest/service worker anyway.
function withoutPluginsNamed(
  prefixes: string[],
  plugins: PluginOption[],
): PluginOption[] {
  const matches = (plugin: PluginOption): boolean =>
    Array.isArray(plugin)
      ? plugin.some(matches)
      : Boolean(
          plugin &&
            typeof plugin === 'object' &&
            'name' in plugin &&
            typeof plugin.name === 'string' &&
            prefixes.some((prefix) =>
              (plugin.name as string).startsWith(prefix),
            ),
        );
  return plugins.filter((p) => !matches(p));
}

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../stories/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y'],
  async viteFinal(cfg) {
    const { default: react } = await import('@vitejs/plugin-react');
    return {
      ...cfg,
      plugins: [
        ...withoutPluginsNamed(
          ['react-router', 'vite-plugin-pwa'],
          cfg.plugins ?? [],
        ),
        react(),
      ],
    };
  },
};

export default config;

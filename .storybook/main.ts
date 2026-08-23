import type { StorybookConfig } from '@storybook/react-vite';
import type { PluginOption } from 'vite';

function withoutReactRouter(plugins: PluginOption[]): PluginOption[] {
  const isReactRouter = (plugin: PluginOption): boolean =>
    Array.isArray(plugin)
      ? plugin.some(isReactRouter)
      : Boolean(
          plugin &&
            typeof plugin === 'object' &&
            'name' in plugin &&
            typeof plugin.name === 'string' &&
            plugin.name.startsWith('react-router'),
        );
  return plugins.filter((p) => !isReactRouter(p));
}

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../stories/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y'],
  async viteFinal(cfg) {
    const { default: react } = await import('@vitejs/plugin-react');
    return {
      ...cfg,
      plugins: [...withoutReactRouter(cfg.plugins ?? []), react()],
    };
  },
};

export default config;

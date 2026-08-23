import type { Meta, StoryObj } from '@storybook/react-vite';

function Tokens() {
  return (
    <div className="p-8 font-sans">
      <h1 className="text-2xl">Editorial Italiana v2 — tokens</h1>
      <p className="text-sm opacity-70">
        Placeholder. The design-track tokens issue replaces this with the full
        palette and type scale.
      </p>
    </div>
  );
}

const meta: Meta<typeof Tokens> = { title: 'Design/Tokens', component: Tokens };
export default meta;
export const Default: StoryObj<typeof Tokens> = {};

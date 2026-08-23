import type { Preview } from '@storybook/react-vite';

import '../app/app.css';

const preview: Preview = {
  parameters: {
    a11y: {
      test: 'todo',
    },
  },
};

export default preview;

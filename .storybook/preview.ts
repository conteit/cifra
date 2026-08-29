import type { Preview } from '@storybook/react-vite';

import '../app/app.css';

// The two widths the design language is drawn for. 900px is the FOUN-09
// boundary: below it the app is mobile (bottom nav), at/above it desktop
// (sidebar). Both are exercised by dedicated stories so a component's
// responsive behaviour is part of its spec, not an afterthought.
const viewports = {
  mobile: {
    name: 'Mobile (402px)',
    type: 'mobile' as const,
    styles: { width: '402px', height: '844px' },
  },
  desktop: {
    name: 'Desktop (1280px)',
    type: 'desktop' as const,
    styles: { width: '1280px', height: '900px' },
  },
};

const preview: Preview = {
  globalTypes: {
    locale: {
      description: 'Interface language (FOUN-07: EN and IT are equal peers)',
      toolbar: {
        icon: 'globe',
        items: [
          { value: 'en', title: 'English' },
          { value: 'it', title: 'Italiano' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    locale: 'en',
    viewport: { value: 'desktop' },
  },
  parameters: {
    a11y: {
      test: 'todo',
    },
    viewport: {
      options: viewports,
    },
    backgrounds: {
      disable: true,
    },
  },
};

export default preview;

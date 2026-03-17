import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://xstate-experiments.github.io',
  integrations: [
    starlight({
      title: 'jsPsych2',
      description: 'Behavioral experiments as statecharts',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/xstate-experiments/jsPsych2' }],
      sidebar: [
        { label: 'Getting Started', slug: 'getting-started' },
        {
          label: 'Core Concepts',
          items: [
            { label: 'Statecharts', slug: 'concepts/statecharts' },
            { label: 'Actors', slug: 'concepts/actors' },
            { label: 'Guards', slug: 'concepts/guards' },
            { label: 'Actions', slug: 'concepts/actions' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Your First Experiment', slug: 'guides/first-experiment' },
            { label: 'Porting from jsPsych', slug: 'guides/porting-from-jspsych' },
            { label: 'Adaptive Designs', slug: 'guides/adaptive-designs' },
          ],
        },
        {
          label: 'Examples',
          items: [
            { label: 'Two-Armed Bandit', slug: 'examples/bandit' },
            { label: 'Go/No-Go', slug: 'examples/go-nogo' },
            { label: 'Reversal Learning', slug: 'examples/reversal-learning' },
            { label: 'Two-Step Task', slug: 'examples/two-step' },
            { label: 'ARC Grid', slug: 'examples/arc-grid' },
          ],
        },
        {
          label: 'API Reference',
          items: [
            { label: 'Core', slug: 'api/core' },
            { label: 'Plugins', slug: 'api/plugins' },
          ],
        },
        { label: 'Vision', slug: 'vision' },
      ],
    }),
  ],
});

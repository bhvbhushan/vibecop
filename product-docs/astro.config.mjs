import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'vibecop',
      description: 'AI code quality toolkit — deterministic linter for the AI coding era',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/bhvbhushan/vibecop' },
      ],
      editLink: {
        baseUrl: 'https://github.com/bhvbhushan/vibecop/edit/main/product-docs/',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'getting-started/introduction' },
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
          ],
        },
        {
          label: 'Agent Integration',
          items: [
            { label: 'Overview', slug: 'agent-integration/overview' },
            { label: 'Claude Code', slug: 'agent-integration/claude-code' },
            { label: 'Cursor', slug: 'agent-integration/cursor' },
            { label: 'Other Tools', slug: 'agent-integration/other-tools' },
            { label: 'MCP Server', slug: 'agent-integration/mcp-server' },
          ],
        },
        {
          label: 'Detectors',
          items: [
            { label: 'Overview', slug: 'detectors/overview' },
            { label: 'Quality', slug: 'detectors/quality' },
            { label: 'Security', slug: 'detectors/security' },
            { label: 'Correctness', slug: 'detectors/correctness' },
            { label: 'Testing', slug: 'detectors/testing' },
          ],
        },
        {
          label: 'Configuration',
          items: [
            { label: 'Config File', slug: 'configuration/config-file' },
            { label: 'Custom Rules', slug: 'configuration/custom-rules' },
            { label: 'CLI Reference', slug: 'configuration/cli-reference' },
          ],
        },
        {
          label: 'GitHub Action',
          slug: 'github-action',
        },
        {
          label: 'Benchmarks',
          slug: 'benchmarks',
        },
        {
          label: 'Architecture',
          slug: 'architecture',
        },
      ],
      customCss: ['./src/styles/custom.css'],
    }),
  ],
  site: 'https://bhvbhushan.github.io',
  base: '/vibecop',
});

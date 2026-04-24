import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const oqlGrammar = JSON.parse(
  readFileSync(fileURLToPath(new URL('./src/grammars/oql.tmLanguage.json', import.meta.url)), 'utf-8'),
)

export default defineConfig({
  site: 'https://vinctustech.github.io',
  base: '/oql-typed',
  integrations: [
    starlight({
      title: '@vinctus/oql-typed',
      description: 'Compile-time typed queries for OQL',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/vinctustech/oql-typed',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/vinctustech/oql-typed/edit/main/docs/',
      },
      expressiveCode: {
        shiki: {
          langs: [oqlGrammar],
        },
      },
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Introduction', link: '/' },
            { label: 'Installation', link: '/install/' },
            { label: 'Quick start', link: '/quick-start/' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Schema', link: '/guides/schema/' },
            { label: 'Queries', link: '/guides/queries/' },
            { label: 'Operators', link: '/guides/operators/' },
            { label: 'Expressions', link: '/guides/expressions/' },
            { label: 'Mutations', link: '/guides/mutations/' },
            { label: 'Conditional QueryBuilder', link: '/guides/query-builder/' },
            { label: 'DM codegen', link: '/guides/codegen/' },
          ],
        },
        {
          label: 'Recipes',
          link: '/recipes/',
        },
        {
          label: 'Reference',
          items: [
            { label: 'Schema API', link: '/reference/schema/' },
            { label: 'Query API', link: '/reference/query/' },
            { label: 'Operators', link: '/reference/operators/' },
          ],
        },
      ],
    }),
  ],
})

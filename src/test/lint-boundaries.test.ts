// @vitest-environment node
import { ESLint } from 'eslint'

// Proves the layer map and the Supabase/fetch bans actually fire (a broken resolver or element
// pattern would otherwise let `npm run lint` pass silently on a clean tree).
const eslint = new ESLint()

async function ruleIds(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.map((m) => m.ruleId ?? 'fatal')
}

const importAdapter =
  "import { supabase } from '@/adapters/supabase/client'\nexport const x = supabase\n"

describe('eslint layer rules', () => {
  it('blocks features -> adapters', async () => {
    expect(await ruleIds('src/features/auth/x.ts', importAdapter)).toContain(
      'boundaries/dependencies',
    )
  })

  it('blocks ui -> app', async () => {
    const code = "import { App } from '@/app/app'\nexport const x = App\n"
    expect(await ruleIds('src/ui/x.ts', code)).toContain('boundaries/dependencies')
  })

  it('blocks app -> adapters outside the composition root', async () => {
    expect(await ruleIds('src/app/x.ts', importAdapter)).toContain('boundaries/dependencies')
  })

  it('allows the composition root to import adapters', async () => {
    expect(await ruleIds('src/app/composition.ts', importAdapter)).not.toContain(
      'boundaries/dependencies',
    )
  })

  it('bans @supabase/* imports and fetch outside src/adapters', async () => {
    const code = [
      "import { createClient } from '@supabase/supabase-js'",
      "import { x as y } from '@supabase/postgrest-js'",
      "export const a = [createClient, y, fetch('/'), window.fetch, globalThis.fetch, self.fetch]",
      '',
    ].join('\n')
    const ids = await ruleIds('src/features/x.ts', code)
    expect(ids.filter((id) => id === 'no-restricted-imports')).toHaveLength(2)
    expect(ids).toContain('no-restricted-globals')
    expect(ids.filter((id) => id === 'no-restricted-properties')).toHaveLength(3)
  })
})

import { describe, expect, it } from 'vitest'

import { analyzeAnswer, buildPrompt } from '@/lib/local-seo/ai-visibility'
import { directoriesFor, guessArea, judgeCitation } from '@/lib/local-seo/citations'

describe('citations', () => {
  it('picks directories by country with a default list', () => {
    expect(directoriesFor('BR').map((d) => d.domain)).toContain('reclameaqui.com.br')
    expect(directoriesFor('us').map((d) => d.domain)).toContain('yelp.com')
    expect(directoriesFor('pt').length).toBeGreaterThan(0)
  })

  it('guesses the city from common address formats', () => {
    expect(guessArea('R. Augusta, 1200 - Consolação, São Paulo - SP, 01304-001')).toBe('São Paulo')
    expect(guessArea('123 Main St, Hingham, MA 02043')).toBe('Hingham')
    expect(guessArea(null)).toBe('')
  })

  it('judges a listing on the right domain against the NAP', () => {
    const v = judgeCitation(
      [
        { link: 'https://www.other.com/x', title: 'Unrelated' },
        { link: 'https://www.yelp.com/biz/bigode-sp', title: 'Bigode Barbearia - São Paulo - Yelp', snippet: 'Rua Augusta 1200 · (11) 3333-4444' },
      ],
      'yelp.com',
      { name: 'Bigode Barbearia', phone: '+55 11 3333-4444', address: 'Rua Augusta, 1200' },
    )
    expect(v).toMatchObject({ found: true, url: 'https://www.yelp.com/biz/bigode-sp', listedName: 'Bigode Barbearia', nameMatch: true, phoneMatch: true, addressMatch: true })
  })

  it('reports unknown instead of mismatch when the snippet has no phone or address', () => {
    const v = judgeCitation([{ link: 'https://facebook.com/bigode', title: 'Bigode Barbearia', snippet: 'Best cuts in town.' }], 'facebook.com', {
      name: 'Bigode Barbearia',
      phone: '+55 11 3333-4444',
      address: 'Rua Augusta, 1200',
    })
    expect(v).toMatchObject({ found: true, phoneMatch: null, addressMatch: null })
    expect(judgeCitation([], 'yelp.com', { name: 'x', phone: null, address: null }).found).toBe(false)
  })
})

describe('AI visibility', () => {
  const answer = `Here are some great options:

1. **Corte Fino** – classic cuts and hot towel shaves.
2. **Bigode Barbearia** – known for beard design and friendly staff.
3. **Navalha de Ouro**: affordable and fast.

Prices vary.`

  it('finds the business, its position and the others listed', () => {
    expect(analyzeAnswer(answer, 'Bigode Barbearia')).toMatchObject({
      mentioned: true,
      position: 2,
      competitors: ['Corte Fino', 'Navalha de Ouro'],
    })
  })

  it('matches on the distinctive part of the name and handles a miss', () => {
    expect(analyzeAnswer(answer, 'Barbearia Bigode').mentioned).toBe(true)
    expect(analyzeAnswer(answer, 'Barbearia Tesoura')).toMatchObject({ mentioned: false, position: null })
  })

  it('writes the prompt in the location language', () => {
    expect(buildPrompt('barbearia', 'São Paulo', 'pt')).toContain('melhores opções de barbearia em São Paulo?')
    expect(buildPrompt('barber shop', 'Hingham', 'en')).toBe('What are the best barber shop options in Hingham? List the top 5 with the business name and a short reason.')
  })
})

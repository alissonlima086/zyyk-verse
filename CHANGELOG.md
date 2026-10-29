# Changelog

Todas as mudanças relevantes do ZYYK Verse são registradas neste arquivo.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e o projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

## [0.1.2] - 2026-10-29

### Corrigido

- Recuperação automática do áudio quando a abertura inicial do projeto ou o
  carregamento da fonte sofre uma falha transitória.
- Preservação das URLs de mídia ainda utilizadas pelo player durante trocas
  rápidas de projeto ou tentativas de recarregamento.
- Geração e cache da waveform pelo backend nativo para áudios MP3, FLAC, WAV e
  OGG, com fallback para a Web Audio API no ambiente de desenvolvimento.

## [0.1.1] - 2026-10-29

### Adicionado

- Interface em português e inglês, com seletor de idioma e preferência
  persistida localmente.
- Localização das mensagens de validação, diálogos, controles da timeline e
  exportação SRT.

### Alterado

- Release consolidada em dois artefatos: AppImage e arquivo de código-fonte
  correspondente.

## [0.1.0] - 2026-10-28

### Adicionado

- Primeira versão pública do editor desktop ZYYK Verse.
- Importação e segmentação de letras por versos e seções.
- Edição lado a lado do texto original e da tradução, com variantes e estados
  de revisão.
- Vault local para criação e organização de projetos e pastas.
- Associação de áudio MP3, FLAC, WAV ou OGG aos projetos.
- Timeline com waveform, playhead, zoom e cues ajustáveis.
- Sincronização de traduções e exportação no formato SRT.
- Distribuição Linux em AppImage com fontes correspondentes e informações de
  conformidade.

[Não lançado]: https://github.com/alissonlima086/zyyk-verse/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/alissonlima086/zyyk-verse/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/alissonlima086/zyyk-verse/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/alissonlima086/zyyk-verse/releases/tag/v0.1.0

# Changelog

All notable changes to ZYYK Verse are documented in this file.
Todas as mudanças relevantes do ZYYK Verse são registradas neste arquivo.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/).
O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e o projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Unreleased] — Não lançado

### English

#### Added

- Guarded release automation for version selection, bilingual changelog
  promotion, manifest updates, validation, commit, pull request, merge,
  multi-architecture build, tag, and GitHub release publication.
- Resume and dry-run modes for safely recovering interrupted releases and
  previewing the next version without changing the repository.
- An unsigned Windows x64 NSIS preview workflow to validate the native MSVC
  build and produce a short-lived test installer on pull requests.

#### Changed

- Interface copy is fully inventoried in the Portuguese and English catalogs,
  including dialog labels, filenames, examples, fallbacks, and user-facing
  error states. Automated checks now reject untranslated visible text.

### Português

#### Adicionado

- Automação protegida de lançamento para seleção de versão, promoção do
  changelog bilíngue, atualização dos manifestos, validação, commit, pull
  request, merge, build multi-arquitetura, tag e publicação da release no
  GitHub.
- Modos de retomada e simulação para recuperar lançamentos interrompidos com
  segurança e visualizar a próxima versão sem alterar o repositório.
- Workflow de preview NSIS Windows x64 sem assinatura para validar o build
  MSVC nativo e produzir um instalador de teste temporário nos pull requests.

#### Alterado

- Os textos da interface foram completamente inventariados nos catálogos em
  português e inglês, incluindo diálogos, nomes de arquivo, exemplos,
  fallbacks e estados de erro visíveis. Verificações automáticas passam a
  recusar textos visíveis sem tradução.

## [0.1.4] - 2026-10-29

### English

#### Added

- High-precision audio engine with in-memory decoding through the Web Audio
  API and a native WAV PCM fallback when WebKit cannot decode the original
  file.
- Tests for fast waveform extraction from the decoded buffer and for the
  native audio fallback.

#### Changed

- The waveform is generated immediately from the same buffer used for
  playback, without an artificial delay or a second decoding pass.
- The timeline playhead now uses the monotonic `AudioContext` clock, keeping
  its movement continuous and synchronized with the sound.
- Releases now attach a single consolidated copyleft source package for both
  architectures while relying on the source archives automatically provided
  by GitHub for the tagged Verse code.
- Release notes are now extracted from this changelog without automatic author
  or pull-request suffixes.

#### Fixed

- Freezes and transient `NotSupportedError` messages when seeking during
  playback.
- Playback continuing while the timeline playhead remained stopped.
- Inconsistent resume behavior after dragging the playhead, pausing, or
  setting in and out points.

### Português

#### Adicionado

- Motor de áudio de alta precisão, com decodificação em memória pela Web Audio
  API e fallback nativo para WAV PCM quando o WebKit não reconhece o arquivo
  original.
- Testes para extração rápida da waveform a partir do buffer decodificado e
  para o fallback nativo de áudio.

#### Alterado

- A waveform passa a ser gerada imediatamente a partir do mesmo buffer usado
  na reprodução, sem espera artificial nem uma segunda decodificação.
- A agulha da timeline passa a usar o relógio monotônico do `AudioContext`,
  mantendo o movimento contínuo e sincronizado com o som.
- Releases passam a anexar um único pacote consolidado de fontes copyleft para
  as duas arquiteturas, aproveitando os arquivos de código-fonte da tag que o
  próprio GitHub disponibiliza.
- Notas das releases passam a ser extraídas deste changelog, sem sufixos
  automáticos de autoria ou número do pull request.

#### Corrigido

- Travamentos e erros transitórios `NotSupportedError` ao buscar outra posição
  enquanto o áudio estava reproduzindo.
- Reprodução que continuava sem que a agulha acompanhasse a posição do áudio.
- Retomada inconsistente depois de arrastar a agulha, pausar ou marcar pontos
  de entrada e saída.

## [0.1.3] - 2026-10-29

### English

#### Added

- Linux ARM64 distribution alongside the x86_64 artifact.
- Empty-project creation with line-by-line lyrics editing, while keeping full
  lyrics import as an alternative.
- Export modal with destination selection, file preview, and SRT, WebVTT, and
  LRC format support.
- Partial project export with a warning and count of untranslated text that
  will be omitted.

#### Changed

- The new project and folder input now appears directly at the insertion
  position in the vault tree.
- The project details button was moved to the project header beside translation
  progress.
- Timeline playback and editing were optimized to reduce layout recalculations,
  repeated lookups, and per-frame reactive work.
- History comparison and duplicate-verse synchronization were optimized for
  larger projects.
- Native waveform generation can now be cancelled when playback begins or a
  newer generation supersedes it.

#### Removed

- The automatic timeline text insertion button, which did not indicate which
  verse would be added.

#### Fixed

- The vault creation menu now closes when clicking outside it.
- The button for adding the next verse remains visible in WebKit when starting
  lyrics line by line.

### Português

#### Adicionado

- Distribuição Linux ARM64 em paralelo ao artefato x86_64.
- Criação de projetos vazios com edição da letra linha por linha, mantendo a
  importação da letra completa como alternativa.
- Modal de exportação com escolha de destino, prévia do arquivo e suporte aos
  formatos SRT, WebVTT e LRC.
- Exportação parcial de projetos, com alerta e contagem dos textos ainda não
  traduzidos que serão omitidos.

#### Alterado

- Campo para criar projetos e pastas exibido diretamente na posição da árvore
  da vault em que o novo item será inserido.
- Botão de detalhes movido para o cabeçalho do projeto, junto ao progresso da
  tradução.
- Reprodução e edição da timeline otimizadas para reduzir recálculos de layout,
  buscas repetidas e trabalho reativo por frame.
- Comparação do histórico e sincronização de versos duplicados otimizadas para
  projetos maiores.
- Geração nativa da waveform agora pode ser cancelada de fato quando a
  reprodução começa ou uma nova geração substitui a anterior.

#### Removido

- Botão de inserção automática de texto na timeline, que não indicava qual
  verso seria adicionado.

#### Corrigido

- Menu de criação da vault agora fecha ao clicar fora dele.
- Botão para adicionar o próximo verso permanece visível no WebKit ao iniciar
  uma letra linha por linha.

## [0.1.2] - 2026-10-29

### English

#### Fixed

- Automatic audio recovery when the initial project opening or source loading
  encounters a transient failure.
- Preservation of media URLs still in use by the player during rapid project
  switches or reload attempts.
- Native waveform generation and caching for MP3, FLAC, WAV, and OGG audio,
  with a Web Audio API fallback in the development environment.

### Português

#### Corrigido

- Recuperação automática do áudio quando a abertura inicial do projeto ou o
  carregamento da fonte sofre uma falha transitória.
- Preservação das URLs de mídia ainda utilizadas pelo player durante trocas
  rápidas de projeto ou tentativas de recarregamento.
- Geração e cache da waveform pelo backend nativo para áudios MP3, FLAC, WAV e
  OGG, com fallback para a Web Audio API no ambiente de desenvolvimento.

## [0.1.1] - 2026-10-29

### English

#### Added

- Portuguese and English interfaces, with a language selector and locally
  persisted preference.
- Localization of validation messages, dialogs, timeline controls, and SRT
  export.

#### Changed

- The release was consolidated into two artifacts: the AppImage and its
  corresponding source archive.

### Português

#### Adicionado

- Interface em português e inglês, com seletor de idioma e preferência
  persistida localmente.
- Localização das mensagens de validação, diálogos, controles da timeline e
  exportação SRT.

#### Alterado

- Release consolidada em dois artefatos: AppImage e arquivo de código-fonte
  correspondente.

## [0.1.0] - 2026-10-28

### English

#### Added

- First public release of the ZYYK Verse desktop editor.
- Lyrics import and segmentation by verse and section.
- Side-by-side editing of source text and translation, with variants and review
  statuses.
- Local vault for creating and organizing projects and folders.
- MP3, FLAC, WAV, or OGG audio association with projects.
- Timeline with waveform, playhead, zoom, and adjustable cues.
- Translation synchronization and SRT export.
- Linux AppImage distribution with corresponding sources and compliance
  information.

### Português

#### Adicionado

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

[Unreleased]: https://github.com/alissonlima086/zyyk-verse/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/alissonlima086/zyyk-verse/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/alissonlima086/zyyk-verse/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/alissonlima086/zyyk-verse/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/alissonlima086/zyyk-verse/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/alissonlima086/zyyk-verse/releases/tag/v0.1.0

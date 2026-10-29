# Changelog

Todas as mudanças relevantes do ZYYK Verse são registradas neste arquivo.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e o projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

## [0.1.4] - 2026-10-29

### Adicionado

- Motor de áudio baseado no ZYYK Studio, com decodificação em memória pela Web
  Audio API e fallback nativo para WAV PCM quando o WebKit não reconhece o
  arquivo original.
- Testes para extração rápida da waveform a partir do buffer decodificado e
  para o fallback nativo de áudio.

### Alterado

- A waveform passa a ser gerada imediatamente a partir do mesmo buffer usado
  na reprodução, sem espera artificial nem uma segunda decodificação.
- A agulha da timeline passa a usar o relógio monotônico do `AudioContext`,
  mantendo o movimento contínuo e sincronizado com o som.
- Releases passam a anexar um único pacote consolidado de fontes copyleft para
  as duas arquiteturas, aproveitando os arquivos de código-fonte da tag que o
  próprio GitHub disponibiliza.
- Notas das releases passam a ser extraídas deste changelog, sem sufixos
  automáticos de autoria ou número do pull request.

### Corrigido

- Travamentos e erros transitórios `NotSupportedError` ao buscar outra posição
  enquanto o áudio estava reproduzindo.
- Reprodução que continuava sem que a agulha acompanhasse a posição do áudio.
- Retomada inconsistente depois de arrastar a agulha, pausar ou marcar pontos
  de entrada e saída.

## [0.1.3] - 2026-10-29

### Adicionado

- Distribuição Linux ARM64 em paralelo ao artefato x86_64.
- Criação de projetos vazios com edição da letra linha por linha, mantendo a
  importação da letra completa como alternativa.
- Modal de exportação com escolha de destino, prévia do arquivo e suporte aos
  formatos SRT, WebVTT e LRC.
- Exportação parcial de projetos, com alerta e contagem dos textos ainda não
  traduzidos que serão omitidos.

### Alterado

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

### Removido

- Botão de inserção automática de texto na timeline, que não indicava qual
  verso seria adicionado.

### Corrigido

- Menu de criação da vault agora fecha ao clicar fora dele.
- Botão para adicionar o próximo verso permanece visível no WebKit ao iniciar
  uma letra linha por linha.

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

[Não lançado]: https://github.com/alissonlima086/zyyk-verse/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/alissonlima086/zyyk-verse/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/alissonlima086/zyyk-verse/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/alissonlima086/zyyk-verse/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/alissonlima086/zyyk-verse/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/alissonlima086/zyyk-verse/releases/tag/v0.1.0

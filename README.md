# ZYYK Verse

ZYYK Verse é um editor desktop para tradução, adaptação e sincronização de letras. A aplicação reúne texto original, tradução, áudio e marcações de tempo em um ambiente único, com foco em fluxos de trabalho locais e organização por projetos.

## Propósito

O projeto foi criado para facilitar a preparação de letras traduzidas e sincronizadas. Ele permite importar uma letra completa, editar original e tradução lado a lado, organizar variações de texto, acompanhar o estado de cada verso e posicionar as linhas sobre a timeline do áudio.

Os projetos são armazenados localmente em uma vault escolhida pelo usuário. Cada arquivo pode ser organizado em pastas, movido ou renomeado dentro da própria aplicação. O conteúdo permanece disponível sem depender de uma conta ou serviço remoto.

## Funcionalidades principais

- Importação e segmentação de letras por versos e seções.
- Edição bilíngue com variantes de tradução e estados de revisão.
- Salvamento automático e histórico local de desfazer e refazer.
- Organização de projetos e pastas em uma vault local.
- Associação de áudio MP3, FLAC, WAV ou OGG ao projeto.
- Visualização de waveform, playhead, zoom e cues ajustáveis.
- Sincronização de linhas traduzidas com precisão temporal.
- Exportação da trilha sincronizada nos formatos SRT, WebVTT e LRC.

## Especificações técnicas

| Camada | Tecnologia |
|---|---|
| Interface | Svelte 5 e TypeScript |
| Aplicação desktop | Tauri 2 |
| Backend local | Rust |
| Build do frontend | Vite |
| Persistência | Arquivos JSON com extensão `.zyykverse` |
| Áudio | Web Audio/WebView2 no Windows; WebKitGTK e GStreamer no Linux |
| Distribuição Linux | AppImage para arquiteturas x86_64 e ARM64 |
| Distribuição Windows | Instalador NSIS x64 não assinado |

A aplicação utiliza uma arquitetura local-first. O frontend gerencia a edição e a interação com a timeline, enquanto o backend Rust valida caminhos, persiste projetos, organiza a vault, gerencia recursos de áudio e fornece o conteúdo de mídia para reprodução local.

O formato `.zyykverse` mantém metadados, segmentos da letra original, unidades de tradução, alinhamentos e trilhas de sincronização. Arquivos de áudio importados são copiados para uma área gerenciada próxima ao projeto, mantendo referências relativas e portabilidade dentro da vault.

O instalador Windows inicial é distribuído sem assinatura digital para manter o
projeto sem custos. Antes de ignorar um possível alerta do Microsoft Defender
SmartScreen, confira se o arquivo veio da GitHub Release oficial e valide seu
SHA-256 pelo `SHA256SUMS` publicado junto da versão.

O roteiro de validação da plataforma está em
[WINDOWS_TESTING.md](WINDOWS_TESTING.md).

## Licença

Copyright (C) 2026 Alisson Lima.

ZYYK Verse é software livre, distribuído sob a [GNU General Public License versão 3 ou posterior](LICENSE).

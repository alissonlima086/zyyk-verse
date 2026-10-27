use crate::model::{AlignmentGroup, SourceKind, SourceSegment, TranslationUnit};
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedLyrics {
    pub source_segments: Vec<SourceSegment>,
    pub translations: Vec<TranslationUnit>,
    pub alignment_groups: Vec<AlignmentGroup>,
    pub line_count: usize,
    pub section_count: usize,
}

pub fn parse_pasted_lyrics(raw: &str) -> ParsedLyrics {
    let normalized = raw
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let mut source_segments = Vec::new();
    let mut translations = Vec::new();
    let mut alignment_groups = Vec::new();
    let mut line_count = 0;
    let mut section_count = 0;
    let mut pending_break = false;

    for raw_line in normalized.lines() {
        let line = raw_line.trim_end();
        if line.trim().is_empty() {
            pending_break = !source_segments.is_empty();
            continue;
        }

        let trimmed = line.trim();
        let explicit_section = trimmed
            .strip_prefix('[')
            .and_then(|value| value.strip_suffix(']'))
            .filter(|value| !value.trim().is_empty());

        if pending_break && explicit_section.is_none() {
            push_section(None, &mut source_segments, &mut alignment_groups);
            section_count += 1;
        }
        pending_break = false;

        if let Some(label) = explicit_section {
            push_section(
                Some(label.trim().to_owned()),
                &mut source_segments,
                &mut alignment_groups,
            );
            section_count += 1;
            continue;
        }

        let source = SourceSegment {
            id: Uuid::new_v4().to_string(),
            kind: SourceKind::Line,
            text: line.to_owned(),
            label: None,
        };
        let translation = TranslationUnit::empty();
        alignment_groups.push(AlignmentGroup {
            id: Uuid::new_v4().to_string(),
            source_segment_ids: vec![source.id.clone()],
            translation_unit_ids: vec![translation.id.clone()],
        });
        source_segments.push(source);
        translations.push(translation);
        line_count += 1;
    }

    ParsedLyrics {
        source_segments,
        translations,
        alignment_groups,
        line_count,
        section_count,
    }
}

fn push_section(
    label: Option<String>,
    source_segments: &mut Vec<SourceSegment>,
    alignment_groups: &mut Vec<AlignmentGroup>,
) {
    let source = SourceSegment {
        id: Uuid::new_v4().to_string(),
        kind: SourceKind::Section,
        text: String::new(),
        label,
    };
    alignment_groups.push(AlignmentGroup {
        id: Uuid::new_v4().to_string(),
        source_segment_ids: vec![source.id.clone()],
        translation_unit_ids: Vec::new(),
    });
    source_segments.push(source);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_newlines_and_collapses_blank_sections() {
        let parsed = parse_pasted_lyrics("\u{feff}First\r\n\r\n\r\nSecond\rThird");
        assert_eq!(parsed.line_count, 3);
        assert_eq!(parsed.section_count, 1);
        assert_eq!(parsed.source_segments.len(), 4);
        assert_eq!(parsed.source_segments[0].text, "First");
        assert_eq!(parsed.source_segments[2].text, "Second");
    }

    #[test]
    fn recognizes_explicit_section_labels() {
        let parsed = parse_pasted_lyrics("[Verse 1]\nLine one\n[Chorus]\nLine two");
        assert_eq!(parsed.line_count, 2);
        assert_eq!(parsed.section_count, 2);
        assert_eq!(parsed.source_segments[0].label.as_deref(), Some("Verse 1"));
        assert_eq!(parsed.source_segments[2].label.as_deref(), Some("Chorus"));
    }

    #[test]
    fn does_not_emit_trailing_blank_section() {
        let parsed = parse_pasted_lyrics("Line one\n\n");
        assert_eq!(parsed.source_segments.len(), 1);
        assert_eq!(parsed.section_count, 0);
    }
}

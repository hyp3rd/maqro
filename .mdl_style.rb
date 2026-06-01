all
# Unordered list indentation: embarrassing.
exclude_rule 'MD005'
exclude_rule 'MD007'
# Parameters: line_length, ignore_code_blocks, code_blocks, tables (number; default 80, boolean; default false, boolean; default true, boolean; default true)
exclude_rule 'MD013'

# MkDocs pages start with YAML frontmatter (---\ntitle: ...\n---), so
# the first line cannot be a top-level heading. MD041 fights that
# convention; the alternative would be losing per-page metadata.
exclude_rule 'MD041'

# MkDocs Material's "grid cards" feature requires `<div class="grid cards">`
# HTML wrappers around a markdown list. MD033 (no inline HTML) flags
# every grid block. Ditto for the surrounding-blank-line rule (MD032)
# which doesn't see the list inside the div as a list. Skipping both
# is the standard Material-theme posture.
exclude_rule 'MD033'
exclude_rule 'MD032'

rule "MD029", style => "one"

# Keep-a-Changelog (https://keepachangelog.com) uses repeated `### Added`,
# `### Fixed`, `### Security` headings under each `## [version]` heading by
# design. MD024 with the default config flags those as duplicates.
# allow_different_nesting permits same-text headings as long as they sit
# under distinct parent headings — which is exactly the Keep-a-Changelog
# shape, and still catches genuine duplicates within the same section.
rule "MD024", :siblings_only => true, :allow_different_nesting => true

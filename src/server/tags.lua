-- A Pandoc filter for the Word export: each tag, a span with the class `tag`, becomes a run of
-- text shaded in its color, set off by a space on either side. Other formats keep the span.
local function escape(text)
  return (text:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end

function Span(span)
  if not span.classes:includes('tag') or not FORMAT:match('docx') then return nil end
  local fill = (span.attributes['color'] or '#DCDCE0'):gsub('#', '')
  local text = escape(pandoc.utils.stringify(span))
  return pandoc.RawInline('openxml',
    '<w:r><w:rPr><w:shd w:val="clear" w:color="auto" w:fill="' .. fill .. '"/><w:sz w:val="18"/></w:rPr>'
    .. '<w:t xml:space="preserve">\194\160' .. text .. '\194\160</w:t></w:r>')
end

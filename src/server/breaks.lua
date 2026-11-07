-- A Pandoc filter for the Word export: the export's page breaks and chapter numbers, written as raw
-- HTML that Word would drop, become a Word page break and a centered, bold paragraph.
local PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'

-- Pandoc reads `<div class="page-break"></div>` as a div of its own, not as raw HTML.
function Div(div)
  if not div.classes:includes('page-break') or not FORMAT:match('docx') then return nil end
  return pandoc.RawBlock('openxml', PAGE_BREAK)
end

function RawBlock(block)
  if block.format ~= 'html' or not FORMAT:match('docx') then return nil end
  if block.text:match('^%s*<div class="page%-break"></div>%s*$') then
    return pandoc.RawBlock('openxml', PAGE_BREAK)
  end
  local label = block.text:match('^%s*<p class="chapter%-number">(.-)</p>%s*$')
  if label then
    return pandoc.RawBlock('openxml',
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">'
      .. label .. '</w:t></w:r></w:p>')
  end
  return nil
end

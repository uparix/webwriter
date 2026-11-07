-- Run as `pandoc lua align-styles.lua file.docx` after the Word export: the paragraph styles that
-- align.lua gives `::: left`, `::: center`, and `::: right` divs are aligned, in the file's styles.
local path = arg[1]
local input = assert(io.open(path, 'rb'))
local bytes = input:read('a')
input:close()

-- Pandoc names a style's id after the style without its spaces.
local ALIGNMENTS = { LeftAligned = 'left', Centered = 'center', RightAligned = 'right' }

local function align(xml)
  local count = 0
  for id, value in pairs(ALIGNMENTS) do
    local found
    xml, found = xml:gsub('(<w:style [^>]*w:styleId="' .. id .. '"[^>]*>.-)(</w:style>)', function(style, close)
      if style:find('<w:jc ', 1, true) then return nil end
      return style .. '<w:pPr><w:jc w:val="' .. value .. '"/></w:pPr>' .. close
    end, 1)
    count = count + found
  end
  return xml, count
end

local changed = false
local entries = {}
for _, entry in ipairs(pandoc.zip.Archive(bytes).entries) do
  if entry.path == 'word/styles.xml' then
    local xml, count = align(entry:contents())
    if count > 0 then
      entry = pandoc.zip.Entry(entry.path, xml, entry.modtime)
      changed = true
    end
  end
  table.insert(entries, entry)
end

if changed then
  local output = assert(io.open(path, 'wb'))
  output:write(pandoc.zip.Archive(entries):bytestring())
  output:close()
end

-- A Pandoc filter for the Word export: a `::: left`, `::: center`, or `::: right` div gets the
-- paragraph style Left Aligned, Centered, or Right Aligned, which align-styles.lua then aligns. A
-- captioned picture inside becomes the picture and its caption as plain paragraphs, since Word would
-- otherwise give them its own figure styles, set to the left.
local STYLES = { left = 'Left Aligned', center = 'Centered', right = 'Right Aligned' }

local function figureAsParagraphs(figure)
  local blocks = pandoc.Blocks(figure.content)
  local caption = pandoc.utils.blocks_to_inlines(figure.caption.long)
  if #caption > 0 then blocks:insert(pandoc.Para({ pandoc.Emph(caption) })) end
  return blocks
end

function Div(div)
  if not FORMAT:match('docx') then return nil end
  local style = nil
  for _, class in ipairs(div.classes) do
    style = STYLES[class] or style
  end
  if not style then return nil end
  div.attributes['custom-style'] = style
  div.content = div.content:walk({ Figure = figureAsParagraphs })
  return div
end

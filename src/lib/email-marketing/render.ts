// @deprecated Legacy /email-marketing system, retired in favor of the
// block-based builder at /settings/email-templates (renderer:
// src/lib/email/render-template.ts). Kept for existing components/data only —
// do not build new features against this. See
// .planning/workstreams/email-builder-hardening/PLAN.md Phase 5.
//
// Assembles a complete email HTML document from a template and its ordered sections.

export type RenderableTemplate = {
  subject_line: string
  preview_text: string
  name: string
}

export type RenderableSection = {
  html_content: string
  sort_order: number
}

export function renderEmailHtml(
  template: RenderableTemplate,
  sections: RenderableSection[],
): string {
  const ordered = [...sections].sort((a, b) => a.sort_order - b.sort_order)
  const body = ordered.map((s) => s.html_content).join('\n')
  const subject = escHtml(template.subject_line || template.name)
  const preview = escHtml(template.preview_text)

  // Pad preheader so email clients don't pull body text as the snippet.
  const preheaderPad = '&nbsp;&zwnj;'.repeat(80)

  return `<!DOCTYPE html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${subject}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { margin: 0 !important; padding: 0 !important; background-color: #f0f0f0; width: 100% !important; }
    a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
    @media only screen and (max-width: 620px) {
      .container { width: 100% !important; max-width: 100% !important; }
      .mobile-pad { padding-left: 20px !important; padding-right: 20px !important; }
      .mobile-stack { display: block !important; width: 100% !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f0f0f0;">
  <!-- Preheader: hidden snippet text shown in inbox -->
  <div style="display:none;font-size:1px;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;mso-hide:all;font-family:sans-serif;">
    ${preview}${preheaderPad}
  </div>

  <!-- Email wrapper -->
  <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%" style="background-color:#f0f0f0;">
    <tr>
      <td align="center" valign="top" style="padding:32px 16px;">
        <!-- Main container | 600px max -->
        <table class="container" border="0" cellpadding="0" cellspacing="0" role="presentation" width="600" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
          <tr>
            <td>
${body}
            </td>
          </tr>
        </table>
        <!-- /container -->
      </td>
    </tr>
  </table>
</body>
</html>`
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

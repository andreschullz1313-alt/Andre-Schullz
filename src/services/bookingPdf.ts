import { jsPDF } from 'jspdf';
import { STUDIO_LOGO_URI } from '../assets/studioMedia';
import { STUDIO_DEFAULTS } from '../data/studioData';
import { formatIsoDateBR } from './scheduleService';

export interface AppointmentPdfPayload {
  bookingId: string;
  date: string;
  time: string;
  clientName: string;
  clientWhatsapp: string;
  style: string;
  bodyZone: string;
  size: string;
  notes?: string;
  couponCode?: string;
  studioName: string;
  studioWhatsapp: string;
  studioInstagram?: string;
  logoUrl?: string;
}

export interface GeneratedAppointmentPdf {
  blob: Blob;
  file: File;
  filename: string;
  download: () => void;
}

async function loadLogoAsPngDataUrl(src: string): Promise<string | null> {
  if (typeof document === 'undefined' || !src) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 160;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.fillStyle = '#0d0d0d';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function createAppointmentOrderPdf(
  payload: AppointmentPdfPayload
): Promise<GeneratedAppointmentPdf> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;

  // Header band
  doc.setFillColor(16, 16, 16);
  doc.rect(0, 0, pageWidth, 42, 'F');
  doc.setFillColor(242, 41, 41);
  doc.rect(0, 42, pageWidth, 2, 'F');

  const logoPng = await loadLogoAsPngDataUrl(payload.logoUrl || STUDIO_LOGO_URI);
  if (logoPng) {
    try {
      doc.addImage(logoPng, 'PNG', margin, 7, 28, 28);
    } catch {
      // Ignore logo render failure and keep text header crisp
    }
  }

  const textStartX = logoPng ? margin + 34 : margin;
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text((payload.studioName || STUDIO_DEFAULTS.studioName).toUpperCase(), textStartX, 17);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(220, 220, 220);
  doc.text(`${STUDIO_DEFAULTS.address}`, textStartX, 24);
  doc.text(
    `WhatsApp: ${payload.studioWhatsapp}  |  Instagram: @${(payload.studioInstagram || STUDIO_DEFAULTS.instagram).replace(/^@/, '')}`,
    textStartX,
    30
  );
  doc.setTextColor(255, 210, 122);
  doc.setFont('helvetica', 'bold');
  doc.text(`Código: ${payload.bookingId}`, textStartX, 36);

  // Document Title
  let y = 55;
  doc.setTextColor(180, 24, 24);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('PEDIDO DE AGENDAMENTO — TATUAGEM', margin, y);

  y += 6;
  doc.setTextColor(95, 95, 95);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `Emitido em ${new Date().toLocaleString('pt-BR')}  |  Status: Pré-Agendado (Aguardando Sinal PIX 50%)`,
    margin,
    y
  );

  // Section 1: Dados da Sessão
  y += 10;
  doc.setFillColor(245, 245, 245);
  doc.roundedRect(margin, y, contentWidth, 56, 2, 2, 'F');
  doc.setDrawColor(215, 215, 215);
  doc.roundedRect(margin, y, contentWidth, 56, 2, 2, 'S');

  doc.setTextColor(180, 24, 24);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('DADOS DA SESSÃO RESERVADA', margin + 5, y + 8);

  const sessionRows: [string, string][] = [
    ['Data da Sessão:', formatIsoDateBR(payload.date)],
    ['Horário:', payload.time],
    ['Porte / Categoria:', payload.size],
    ['Estilo:', payload.style],
    ['Parte do Corpo:', payload.bodyZone],
  ];

  doc.setFontSize(10);
  let rowY = y + 16;
  for (const [label, value] of sessionRows) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(50, 50, 50);
    doc.text(label, margin + 5, rowY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(20, 20, 20);
    doc.text(String(value || '—').slice(0, 72), margin + 45, rowY);
    rowY += 8;
  }

  // Section 2: Dados do Cliente
  y += 64;
  doc.setFillColor(250, 250, 250);
  doc.roundedRect(margin, y, contentWidth, 50, 2, 2, 'F');
  doc.setDrawColor(215, 215, 215);
  doc.roundedRect(margin, y, contentWidth, 50, 2, 2, 'S');

  doc.setTextColor(180, 24, 24);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('DADOS DO CLIENTE', margin + 5, y + 8);

  doc.setFontSize(10);
  let clientY = y + 16;
  const clientRows: [string, string][] = [
    ['Nome Completo:', payload.clientName],
    ['WhatsApp:', payload.clientWhatsapp],
    ['Cupom:', payload.couponCode || 'Nenhum informado'],
  ];
  for (const [label, value] of clientRows) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(50, 50, 50);
    doc.text(label, margin + 5, clientY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(20, 20, 20);
    doc.text(String(value || '—').slice(0, 72), margin + 45, clientY);
    clientY += 8;
  }

  const notesText = payload.notes?.trim() || 'Sem observações adicionais.';
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(50, 50, 50);
  doc.text('Observações:', margin + 5, clientY);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(20, 20, 20);
  const wrappedNotes = doc.splitTextToSize(notesText, contentWidth - 50).slice(0, 2);
  doc.text(wrappedNotes, margin + 45, clientY);

  // Section 3: Regra do Sinal de 50% & Chave PIX via WhatsApp
  y += 58;
  doc.setFillColor(255, 246, 246);
  doc.setDrawColor(242, 41, 41);
  doc.setLineWidth(0.6);
  doc.roundedRect(margin, y, contentWidth, 56, 2, 2, 'FD');

  doc.setTextColor(180, 24, 24);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('CONFIRMAÇÃO VIA PIX (SINAL DE 50%)', margin + 5, y + 9);

  doc.setTextColor(35, 35, 35);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.8);
  const pixParagraph1 =
    '• A confirmação definitiva do agendamento só é efetivada após o envio do pagamento de 50% do valor total da tattoo como sinal (separação de materiais, preparação e alteração da arte e acompanhamento via WhatsApp).';
  const pixParagraph2 =
    '• A chave PIX para pagamento do sinal é enviada diretamente pelo estúdio via WhatsApp. Encaminhe este PDF no atendimento para receber a chave PIX e validar sua reserva.';

  const p1Lines = doc.splitTextToSize(pixParagraph1, contentWidth - 10);
  doc.text(p1Lines, margin + 5, y + 17);
  const p2Lines = doc.splitTextToSize(pixParagraph2, contentWidth - 10);
  doc.text(p2Lines, margin + 5, y + 17 + p1Lines.length * 5.2 + 3);

  // Footer
  doc.setTextColor(115, 115, 115);
  doc.setFontSize(8.5);
  doc.text(
    `${payload.studioName} · Agendamento sujeito à confirmação do sinal de 50% via PIX no WhatsApp (+${payload.studioWhatsapp.replace(/\D/g, '')})`,
    pageWidth / 2,
    283,
    { align: 'center' }
  );

  const safeCode = payload.bookingId.replace(/[^a-zA-Z0-9_-]/g, '');
  const filename = `Pedido-Agendamento-${safeCode}.pdf`;
  const blob = doc.output('blob');
  const file = new File([blob], filename, { type: 'application/pdf' });

  return {
    blob,
    file,
    filename,
    download: () => triggerBlobDownload(blob, filename),
  };
}

import { OUTCOME_LABELS } from "../domain/rubric";
import type { FinalOutcome, StudentReportViewModel } from "../domain/types";
import {
  computePngLayout,
  PNG_CONTENT_WIDTH,
  PNG_PADDING,
  PNG_WIDTH,
} from "./pngLayout";

const FONT_STACK = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function outcomeColors(outcome: FinalOutcome | null): { bg: string; fg: string } {
  if (outcome === "IDONEO") {
    return { bg: "#166534", fg: "#ffffff" };
  }
  if (outcome === "MODULO_INTEGRATIVO") {
    return { bg: "#b45309", fg: "#ffffff" };
  }
  return { bg: "#b91c1c", fg: "#ffffff" };
}

export async function renderReportPng(vm: StudentReportViewModel): Promise<File> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Contesto Canvas 2D non disponibile su questo browser.");
  }

  try {
    const measureText = (text: string, fontSizePx: number, bold = false): number => {
      ctx.font = `${bold ? "700" : "400"} ${fontSizePx}px ${FONT_STACK}`;
      return ctx.measureText(text).width;
    };

    const layout = computePngLayout(vm, measureText);
    const cardPad = layout.compact ? 22 : 28;
    const bodyFont = layout.compact ? 26 : 28;
    const lineHeight = layout.compact ? 33 : 36;

    // Fixed dpr = 1 backing store: 1080 x <=1920 (< 2.1M px, well under iOS 16.7M px ceiling)
    canvas.width = PNG_WIDTH;
    canvas.height = layout.totalHeight;

    // Background
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 1. Header Card
    ctx.fillStyle = "#0f3d5e";
    drawRoundedRect(ctx, PNG_PADDING, layout.header.y, PNG_CONTENT_WIDTH, layout.header.height, 20);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = `700 34px ${FONT_STACK}`;
    ctx.textBaseline = "top";
    ctx.fillText("VALUTAZIONE TUTELA VRU", PNG_PADDING + 28, layout.header.y + 22);

    // Outcome badge top-right
    const badgeLabel = vm.finalOutcome ? OUTCOME_LABELS[vm.finalOutcome] : "IN ATTESA";
    const badgePalette = outcomeColors(vm.finalOutcome);
    ctx.font = `700 24px ${FONT_STACK}`;
    const badgeW = Math.max(190, ctx.measureText(badgeLabel).width + 44);
    const badgeH = 48;
    const badgeX = PNG_PADDING + PNG_CONTENT_WIDTH - badgeW - 24;
    const badgeY = layout.header.y + 20;
    ctx.fillStyle = badgePalette.bg;
    drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 12);
    ctx.fill();
    ctx.fillStyle = badgePalette.fg;
    ctx.textAlign = "center";
    ctx.fillText(badgeLabel, badgeX + badgeW / 2, badgeY + 12);
    ctx.textAlign = "left";

    let headerTextY = layout.header.y + 70;
    if (layout.header.studentLine) {
      ctx.fillStyle = "#e2e8f0";
      ctx.font = `700 28px ${FONT_STACK}`;
      ctx.fillText(layout.header.studentLine, PNG_PADDING + 28, headerTextY);
      headerTextY += 36;
    }

    ctx.fillStyle = "#cbd5e1";
    ctx.font = `400 24px ${FONT_STACK}`;
    ctx.fillText(layout.header.metaLine, PNG_PADDING + 28, headerTextY);

    // 2. Scores & Calibration Card
    ctx.fillStyle = "#ffffff";
    drawRoundedRect(
      ctx,
      PNG_PADDING,
      layout.scoresCard.y,
      PNG_CONTENT_WIDTH,
      layout.scoresCard.height,
      18,
    );
    ctx.fill();
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2;
    ctx.stroke();

    const sY = layout.scoresCard.y + cardPad;
    const colW = (PNG_CONTENT_WIDTH - cardPad * 2) / 3;

    // Col 1: Instructor
    ctx.fillStyle = "#475569";
    ctx.font = `600 22px ${FONT_STACK}`;
    ctx.fillText("ISTRUTTORE (I)", PNG_PADDING + cardPad, sY);
    ctx.fillStyle = "#0f3d5e";
    ctx.font = `700 44px ${FONT_STACK}`;
    ctx.fillText(`${vm.metrics.totalI} / ${vm.metrics.maxScore}`, PNG_PADDING + cardPad, sY + 32);

    // Col 2: Student
    ctx.fillStyle = "#475569";
    ctx.font = `600 22px ${FONT_STACK}`;
    ctx.fillText("ALLIEVO (A)", PNG_PADDING + cardPad + colW, sY);
    ctx.fillStyle = "#d97706";
    ctx.font = `700 44px ${FONT_STACK}`;
    ctx.fillText(
      `${vm.metrics.totalA} / ${vm.metrics.maxScore}`,
      PNG_PADDING + cardPad + colW,
      sY + 32,
    );

    // Col 3: Calibration Delta
    const deltaSign = vm.metrics.overconfidenceDelta > 0 ? "+" : "";
    ctx.fillStyle = "#475569";
    ctx.font = `600 22px ${FONT_STACK}`;
    ctx.fillText("CALIBRAZIONE (A - I)", PNG_PADDING + cardPad + colW * 2, sY);
    ctx.fillStyle = vm.metrics.isOverconfidenceCritical ? "#b91c1c" : "#0f172a";
    ctx.font = `700 34px ${FONT_STACK}`;
    ctx.fillText(
      `${deltaSign}${vm.metrics.overconfidenceDelta} • ${vm.calibrationLabel}`,
      PNG_PADDING + cardPad + colW * 2 - 20,
      sY + 38,
    );

    let hintY = sY + (layout.compact ? 94 : 106);
    ctx.fillStyle = "#334155";
    ctx.font = `400 ${bodyFont}px ${FONT_STACK}`;
    for (const line of layout.scoresCard.calibrationHintLines) {
      ctx.fillText(line, PNG_PADDING + cardPad, hintY);
      hintY += lineHeight;
    }

    // 3. 6-Domain Horizontal Comparison Chart Card
    ctx.fillStyle = "#ffffff";
    drawRoundedRect(
      ctx,
      PNG_PADDING,
      layout.chartCard.y,
      PNG_CONTENT_WIDTH,
      layout.chartCard.height,
      18,
    );
    ctx.fill();
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#0f172a";
    ctx.font = `700 28px ${FONT_STACK}`;
    ctx.fillText(
      "CONFRONTO DOMINI (Soglia 4/5)",
      PNG_PADDING + cardPad,
      layout.chartCard.y + cardPad,
    );

    // Legend top-right
    const legendY = layout.chartCard.y + cardPad + 4;
    const legendBaseX = PNG_PADDING + PNG_CONTENT_WIDTH - cardPad - 360;
    ctx.fillStyle = "#0f3d5e";
    ctx.fillRect(legendBaseX, legendY + 4, 22, 18);
    ctx.fillStyle = "#1e293b";
    ctx.font = `600 22px ${FONT_STACK}`;
    ctx.fillText("Istruttore", legendBaseX + 30, legendY);

    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(legendBaseX + 165, legendY + 4, 22, 18);
    ctx.fillStyle = "#1e293b";
    ctx.fillText("Allievo", legendBaseX + 195, legendY);

    const barAreaX = PNG_PADDING + cardPad;
    const barAreaW = PNG_CONTENT_WIDTH - cardPad * 2 - 74;
    const thresholdX = barAreaX + barAreaW * 0.8;

    // Vertical 4/5 threshold line spanning all rows
    ctx.save();
    ctx.strokeStyle = "#166534";
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(thresholdX, layout.chartCard.firstRowY - 6);
    ctx.lineTo(
      thresholdX,
      layout.chartCard.firstRowY + vm.domainRows.length * layout.chartCard.rowHeight - 10,
    );
    ctx.stroke();
    ctx.restore();

    vm.domainRows.forEach((row, index) => {
      const rowY = layout.chartCard.firstRowY + index * layout.chartCard.rowHeight;
      ctx.fillStyle = "#0f172a";
      ctx.font = `700 24px ${FONT_STACK}`;
      const rowTitle = row.isBlindSpot ? `${row.label}  [Punto cieco]` : row.label;
      ctx.fillText(rowTitle, barAreaX, rowY);

      if (row.instructorScore === null || row.studentScore === null) {
        ctx.fillStyle = "#e2e8f0";
        drawRoundedRect(ctx, barAreaX, rowY + 30, 170, 30, 8);
        ctx.fill();
        ctx.fillStyle = "#475569";
        ctx.font = `700 21px ${FONT_STACK}`;
        ctx.fillText("N/A (no ADAS)", barAreaX + 14, rowY + 34);
        return;
      }

      const barH = layout.compact ? 14 : 16;
      const trackY1 = rowY + 30;
      const trackY2 = trackY1 + barH + 5;

      // Track backgrounds
      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(barAreaX, trackY1, barAreaW, barH);
      ctx.fillRect(barAreaX, trackY2, barAreaW, barH);

      // Instructor bar
      ctx.fillStyle = "#0f3d5e";
      ctx.fillRect(barAreaX, trackY1, (row.instructorScore / 5) * barAreaW, barH);
      // Student bar
      ctx.fillStyle = "#f59e0b";
      ctx.fillRect(barAreaX, trackY2, (row.studentScore / 5) * barAreaW, barH);

      // Numeric labels at right
      ctx.fillStyle = "#0f3d5e";
      ctx.font = `700 20px ${FONT_STACK}`;
      ctx.fillText(`I:${row.instructorScore}`, barAreaX + barAreaW + 12, trackY1 - 2);
      ctx.fillStyle = "#b45309";
      ctx.fillText(`A:${row.studentScore}`, barAreaX + barAreaW + 12, trackY2 - 1);
    });

    // 4. Red Flags Card
    if (vm.activeRedFlags.length === 0) {
      ctx.fillStyle = "#dcfce7";
      drawRoundedRect(
        ctx,
        PNG_PADDING,
        layout.redFlagsCard.y,
        PNG_CONTENT_WIDTH,
        layout.redFlagsCard.height,
        18,
      );
      ctx.fill();
      ctx.strokeStyle = "#166534";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = "#166534";
      ctx.font = `700 28px ${FONT_STACK}`;
      ctx.fillText(
        "✓  0 Red Flag rilevate durante la prova",
        PNG_PADDING + cardPad,
        layout.redFlagsCard.y + (layout.redFlagsCard.height - 28) / 2,
      );
    } else {
      ctx.fillStyle = "#fef2f2";
      drawRoundedRect(
        ctx,
        PNG_PADDING,
        layout.redFlagsCard.y,
        PNG_CONTENT_WIDTH,
        layout.redFlagsCard.height,
        18,
      );
      ctx.fill();
      ctx.strokeStyle = "#b91c1c";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = "#991b1b";
      ctx.font = `700 28px ${FONT_STACK}`;
      ctx.fillText(
        `RED FLAG RILEVATE (${vm.activeRedFlags.length})`,
        PNG_PADDING + cardPad,
        layout.redFlagsCard.y + cardPad,
      );

      for (const rf of layout.redFlagsCard.items) {
        ctx.fillStyle = "#b91c1c";
        ctx.font = `700 26px ${FONT_STACK}`;
        ctx.fillText(`${rf.displayCode} — ${rf.title}`, PNG_PADDING + cardPad, rf.y);
        ctx.fillStyle = "#7f1d1d";
        ctx.font = `400 ${bodyFont}px ${FONT_STACK}`;
        let ay = rf.y + (layout.compact ? 32 : 36);
        for (const line of rf.actionLines) {
          ctx.fillText(line, PNG_PADDING + cardPad + 10, ay);
          ay += lineHeight;
        }
      }
    }

    // 5. Deterministic Review Tips Card
    ctx.fillStyle = "#ffffff";
    drawRoundedRect(
      ctx,
      PNG_PADDING,
      layout.tipsCard.y,
      PNG_CONTENT_WIDTH,
      layout.tipsCard.height,
      18,
    );
    ctx.fill();
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#0f172a";
    ctx.font = `700 28px ${FONT_STACK}`;
    ctx.fillText(
      "PROMEMORIA PER IL RIPASSO",
      PNG_PADDING + cardPad,
      layout.tipsCard.y + cardPad,
    );

    for (const tip of layout.tipsCard.items) {
      const tagColor =
        tip.source === "red_flag"
          ? "#b91c1c"
          : tip.source === "positive"
            ? "#166534"
            : "#0f3d5e";
      ctx.fillStyle = tagColor;
      ctx.font = `700 24px ${FONT_STACK}`;
      ctx.fillText(`• ${tip.code}`, PNG_PADDING + cardPad, tip.y);

      ctx.fillStyle = "#1e293b";
      ctx.font = `400 ${bodyFont}px ${FONT_STACK}`;
      let ty = tip.y + (layout.compact ? 30 : 34);
      for (const line of tip.lines) {
        ctx.fillText(line, PNG_PADDING + cardPad + 16, ty);
        ty += lineHeight;
      }
    }

    // 6. Footer
    ctx.fillStyle = "#64748b";
    ctx.font = `400 21px ${FONT_STACK}`;
    ctx.fillText(
      "Scheda VRU • Protocollo CIECA / EFA / FORS (GDE 1–4) • Nessun archivio nominativo",
      PNG_PADDING + 8,
      layout.footerY,
    );

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), "image/png");
    });

    if (!blob) {
      throw new Error("Impossibile esportare il PNG dalla memoria grafica del dispositivo.");
    }

    const fileName = `valutazione-vru-${vm.lessonDate}.png`;
    return new File([blob], fileName, { type: "image/png" });
  } finally {
    // Release iOS Safari GPU backing store immediately
    canvas.width = 0;
    canvas.height = 0;
  }
}

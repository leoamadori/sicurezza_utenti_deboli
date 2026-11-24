import type { StudentReportViewModel } from "../domain/types";

export const PNG_WIDTH = 1080;
export const PNG_MAX_HEIGHT = 1920;
export const PNG_PADDING = 44;
export const PNG_CONTENT_WIDTH = PNG_WIDTH - PNG_PADDING * 2;

export type MeasureTextFn = (text: string, fontSizePx: number, bold?: boolean) => number;

export interface WrappedRedFlagBlock {
  displayCode: string;
  title: string;
  actionLines: string[];
  y: number;
  height: number;
}

export interface WrappedTipBlock {
  code: string;
  source: "red_flag" | "low_domain" | "blind_spot" | "positive";
  lines: string[];
  y: number;
  height: number;
}

export interface PngLayoutSpec {
  width: number;
  totalHeight: number;
  compact: boolean;
  header: {
    y: number;
    height: number;
    studentLine: string | null;
    metaLine: string;
  };
  scoresCard: {
    y: number;
    height: number;
    calibrationHintLines: string[];
  };
  chartCard: {
    y: number;
    height: number;
    rowHeight: number;
    firstRowY: number;
  };
  redFlagsCard: {
    y: number;
    height: number;
    items: WrappedRedFlagBlock[];
  };
  tipsCard: {
    y: number;
    height: number;
    items: WrappedTipBlock[];
  };
  footerY: number;
}

export function wrapText(
  text: string,
  maxWidth: number,
  measureText: MeasureTextFn,
  fontSizePx: number,
  maxLines: number,
  bold = false,
): string[] {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (!cleaned) {
    return [];
  }

  const words = cleaned.split(" ");
  const lines: string[] = [];
  let current = "";

  const pushEllipsized = (line: string): string => {
    let candidate = line.trimEnd();
    while (candidate.length > 1 && measureText(`${candidate}…`, fontSizePx, bold) > maxWidth) {
      candidate = candidate.slice(0, -1).trimEnd();
    }
    return `${candidate}…`;
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? "";
    const testLine = current ? `${current} ${word}` : word;

    if (measureText(testLine, fontSizePx, bold) <= maxWidth) {
      current = testLine;
      continue;
    }

    if (current) {
      if (lines.length === maxLines - 1) {
        lines.push(pushEllipsized(current));
        return lines;
      }
      lines.push(current);
      current = word;
    } else {
      // Single word wider than maxWidth
      if (lines.length === maxLines - 1) {
        lines.push(pushEllipsized(word));
        return lines;
      }
      let slice = word;
      while (slice.length > 1 && measureText(slice, fontSizePx, bold) > maxWidth) {
        slice = slice.slice(0, -1);
      }
      lines.push(slice);
      current = word.slice(slice.length);
    }
  }

  if (current) {
    if (lines.length >= maxLines) {
      const lastIndex = maxLines - 1;
      lines[lastIndex] = pushEllipsized(lines[lastIndex] ?? current);
    } else if (measureText(current, fontSizePx, bold) > maxWidth) {
      lines.push(pushEllipsized(current));
    } else {
      lines.push(current);
    }
  }

  return lines.slice(0, maxLines);
}

function buildLayoutPass(
  vm: StudentReportViewModel,
  measureText: MeasureTextFn,
  compact: boolean,
): PngLayoutSpec {
  const sectionGap = compact ? 16 : 24;
  const cardPad = compact ? 22 : 28;
  const bodyFont = compact ? 26 : 28;
  const lineHeight = compact ? 33 : 36;
  const rfMaxLines = compact ? 1 : 2;
  const tipMaxLines = compact ? 2 : 3;

  let cursorY = compact ? 28 : 36;

  // 1. Header
  const studentLine = vm.studentLabel
    ? wrapText(`Allievo: ${vm.studentLabel}`, PNG_CONTENT_WIDTH - 320, measureText, 28, 1, true)[0] ?? null
    : null;
  const metaLine = `${vm.lessonDate}  •  ${vm.vehicleLabel}  •  ${vm.kmBucketLabel}  •  ${vm.weatherLabel} / ${vm.lightLabel}`;
  const headerHeight = studentLine ? (compact ? 148 : 164) : (compact ? 116 : 132);
  const header = {
    y: cursorY,
    height: headerHeight,
    studentLine,
    metaLine,
  };
  cursorY += headerHeight + sectionGap;

  // 2. Scores & Calibration card
  const calibrationHintLines = wrapText(
    vm.calibrationHint,
    PNG_CONTENT_WIDTH - cardPad * 2,
    measureText,
    bodyFont,
    compact ? 1 : 2,
    false,
  );
  const scoresHeight =
    cardPad * 2 + (compact ? 104 : 118) + calibrationHintLines.length * lineHeight;
  const scoresCard = {
    y: cursorY,
    height: scoresHeight,
    calibrationHintLines,
  };
  cursorY += scoresHeight + sectionGap;

  // 3. 6-Domain horizontal comparison chart card
  const rowHeight = compact ? 68 : 78;
  const chartHeaderH = compact ? 58 : 68;
  const chartHeight = cardPad * 2 + chartHeaderH + vm.domainRows.length * rowHeight;
  const chartCard = {
    y: cursorY,
    height: chartHeight,
    rowHeight,
    firstRowY: cursorY + cardPad + chartHeaderH,
  };
  cursorY += chartHeight + sectionGap;

  // 4. Red Flags card
  const rfStartY = cursorY;
  const rfItems: WrappedRedFlagBlock[] = [];
  let rfHeight: number;
  if (vm.activeRedFlags.length === 0) {
    rfHeight = compact ? 76 : 86;
  } else {
    let itemY = rfStartY + cardPad + (compact ? 42 : 48);
    for (const rf of vm.activeRedFlags) {
      const actionLines = wrapText(
        rf.correctiveAction,
        PNG_CONTENT_WIDTH - cardPad * 2 - 20,
        measureText,
        bodyFont,
        rfMaxLines,
        false,
      );
      const itemH = (compact ? 36 : 40) + actionLines.length * lineHeight + (compact ? 10 : 14);
      rfItems.push({
        displayCode: rf.displayCode,
        title: rf.title,
        actionLines,
        y: itemY,
        height: itemH,
      });
      itemY += itemH + (compact ? 8 : 12);
    }
    rfHeight = itemY - rfStartY + cardPad - (compact ? 8 : 12);
  }
  const redFlagsCard = {
    y: rfStartY,
    height: rfHeight,
    items: rfItems,
  };
  cursorY += rfHeight + sectionGap;

  // 5. Deterministic review tips card (max 4 pngTips)
  const tipsStartY = cursorY;
  const tipItems: WrappedTipBlock[] = [];
  let tipY = tipsStartY + cardPad + (compact ? 42 : 48);
  for (const tip of vm.pngTips) {
    const lines = wrapText(
      tip.text,
      PNG_CONTENT_WIDTH - cardPad * 2 - 24,
      measureText,
      bodyFont,
      tipMaxLines,
      false,
    );
    const itemH = (compact ? 32 : 36) + lines.length * lineHeight + (compact ? 8 : 12);
    tipItems.push({
      code: tip.code,
      source: tip.source,
      lines,
      y: tipY,
      height: itemH,
    });
    tipY += itemH + (compact ? 8 : 12);
  }
  const tipsHeight = tipY - tipsStartY + cardPad - (compact ? 8 : 12);
  const tipsCard = {
    y: tipsStartY,
    height: tipsHeight,
    items: tipItems,
  };
  cursorY += tipsHeight + (compact ? 22 : 28);

  const footerY = cursorY;
  const totalHeight = footerY + (compact ? 28 : 36);

  return {
    width: PNG_WIDTH,
    totalHeight,
    compact,
    header,
    scoresCard,
    chartCard,
    redFlagsCard,
    tipsCard,
    footerY,
  };
}

export function computePngLayout(
  vm: StudentReportViewModel,
  measureText: MeasureTextFn,
): PngLayoutSpec {
  const regular = buildLayoutPass(vm, measureText, false);
  if (regular.totalHeight <= PNG_MAX_HEIGHT) {
    return regular;
  }
  const compact = buildLayoutPass(vm, measureText, true);
  return {
    ...compact,
    totalHeight: Math.min(compact.totalHeight, PNG_MAX_HEIGHT),
  };
}

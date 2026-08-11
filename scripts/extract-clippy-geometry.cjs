const fs = require('node:fs');
const path = require('node:path');
const { SVGPathData, SVGPathDataTransformer, encodeSVGPath } = require('svg-pathdata');

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error('Usage: node scripts/extract-clippy-geometry.cjs <trace.svg> <output.svg>');
}

const source = fs.readFileSync(path.resolve(inputPath), 'utf8');

function pathFor(className) {
  const tag = source.match(new RegExp(`<path\\b[^>]*class=["']${className}["'][^>]*/?>`, 'i'))?.[0];
  const data = tag?.match(/\bd=["']([^"']+)["']/i)?.[1];
  if (!data) throw new Error(`Could not extract path class ${className}`);
  return data;
}

function pathForFill(fill) {
  const tags = [...source.matchAll(/<path\b[^>]*\/?>/gi)].map((match) => match[0]);
  const tag = tags.find((candidate) => {
    const candidateFill = candidate.match(/\bfill=["'](#[0-9a-f]{6})["']/i)?.[1];
    return candidateFill?.toLowerCase() === fill.toLowerCase();
  });
  const data = tag?.match(/\bd=["']([^"']+)["']/i)?.[1];
  if (!data) throw new Error(`Could not extract path fill ${fill}`);
  return data;
}

function subpathsForData(data) {
  const commands = new SVGPathData(data)
    .transform(SVGPathDataTransformer.TO_ABS())
    .commands;
  const subpaths = [];
  for (const command of commands) {
    if (command.type === SVGPathData.MOVE_TO) subpaths.push([]);
    subpaths.at(-1).push(command);
  }
  return subpaths.map((commands, index) => {
    const data = encodeSVGPath(commands);
    const bounds = new SVGPathData(data).getBounds();
    return {
      index,
      data,
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
    };
  });
}

function subpathsFor(className) {
  return subpathsForData(pathFor(className));
}

if (process.env.CLIPPY_GEOMETRY_INSPECT) {
  if (/<path\b[^>]*class=["']f["']/i.test(source)) {
    for (const className of ['a', 'c', 'f']) {
      console.log(`\nclass ${className}`);
      console.table(subpathsFor(className).map(({ data, ...details }) => details));
    }
  } else {
    for (const fill of ['#fefefe', '#8f8fb2', '#383e48']) {
      console.log(`\nfill ${fill}`);
      console.table(subpathsForData(pathForFill(fill)).map(({ data, ...details }) => details));
    }
  }
}

function selectedPath(className, indexes) {
  return selectedPathFromData(pathFor(className), indexes);
}

function selectedPathFromData(data, indexes) {
  const wanted = new Set(indexes);
  return subpathsForData(data)
    .filter((subpath) => wanted.has(subpath.index))
    .map((subpath) => subpath.data)
    .join('');
}

const isLegacyClassTrace = /<path\b[^>]*class=["']f["']/i.test(source);

// Both tracers group same-colored regions into compound paths. The older
// class-based trace also groups in ruled-paper noise, so it needs subpath
// filtering. The newer inline-color trace already separates the clean Clippy
// layers from the paper and can be copied without simplifying its geometry.
const eyeFill = isLegacyClassTrace ? selectedPath('a', [7, 9]) : pathForFill('#fefefe');
const wireFill = isLegacyClassTrace ? selectedPath('c', [0, 3, 15, 44, 50]) : pathForFill('#8f8fb2');
const outline = isLegacyClassTrace
  ? selectedPath('f', [0, 1, 2, 3, 5, 6, 7, 8])
  : pathForFill('#383e48');
const features = isLegacyClassTrace ? pathFor('b') : '';
const outlineColor = isLegacyClassTrace ? '#393e48' : '#383e48';
const paperRules = isLegacyClassTrace ? '' : pathForFill('#7eae87');
const paperDetails = isLegacyClassTrace ? '' : pathForFill('#aeae63');
const paperFill = isLegacyClassTrace ? '' : pathForFill('#e7e1a0');
const inlineWhite = isLegacyClassTrace ? '' : pathForFill('#fefefe');
const inlineWire = isLegacyClassTrace ? '' : pathForFill('#8f8fb2');
const inlineDark = isLegacyClassTrace ? '' : pathForFill('#383e48');
const rig = isLegacyClassTrace ? null : {
  arch: selectedPathFromData(inlineWire, [0, 1]),
  leftConnector: selectedPathFromData(inlineWire, [2]),
  rightConnector: selectedPathFromData(inlineWire, [3]),
  outerLoop: selectedPathFromData(inlineWire, [7]),
  innerLoop: selectedPathFromData(inlineWire, [8]),
  leftEye: selectedPathFromData(inlineWhite, [1]),
  rightEye: selectedPathFromData(inlineWhite, [3]),
  leftPupil: selectedPathFromData(inlineDark, [5]),
  rightPupil: selectedPathFromData(inlineDark, [7]),
};

const geometry = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1400">
  <defs>
    <g id="clippy-paper">
      ${paperRules ? `<path fill="#7eae87" fill-rule="evenodd" d="${paperRules}"/>` : ''}
      ${paperDetails ? `<path fill="#aeae63" fill-rule="evenodd" d="${paperDetails}"/>` : ''}
      ${paperFill ? `<path fill="#e7e1a0" fill-rule="evenodd" d="${paperFill}"/>` : ''}
    </g>
    <g id="clippy-wire-fill">
      <path fill-rule="evenodd" d="${wireFill}"/>
    </g>
    <g id="clippy-eye-fill">
      <path fill-rule="evenodd" d="${eyeFill}"/>
    </g>
    <g id="clippy-outline">
      <path fill="${outlineColor}" fill-rule="evenodd" d="${outline}"/>
    </g>
    <g id="clippy-features">
      ${features ? `<path fill="#0f0f0f" fill-rule="evenodd" d="${features}"/>` : ''}
    </g>
    <g id="clippy-wire-arch"><path fill-rule="evenodd" d="${rig?.arch || ''}"/></g>
    <g id="clippy-wire-left-connector"><path fill-rule="evenodd" d="${rig?.leftConnector || ''}"/></g>
    <g id="clippy-wire-right-connector"><path fill-rule="evenodd" d="${rig?.rightConnector || ''}"/></g>
    <g id="clippy-wire-outer-loop"><path fill-rule="evenodd" d="${rig?.outerLoop || ''}"/></g>
    <g id="clippy-wire-inner-loop"><path fill-rule="evenodd" d="${rig?.innerLoop || ''}"/></g>
    <g id="clippy-left-eye"><path fill-rule="evenodd" d="${rig?.leftEye || ''}"/></g>
    <g id="clippy-right-eye"><path fill-rule="evenodd" d="${rig?.rightEye || ''}"/></g>
    <g id="clippy-left-pupil"><path fill-rule="evenodd" d="${rig?.leftPupil || ''}"/></g>
    <g id="clippy-right-pupil"><path fill-rule="evenodd" d="${rig?.rightPupil || ''}"/></g>
  </defs>
</svg>
`;

fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(path.resolve(outputPath), geometry);
console.log(`Extracted exact Clippy geometry to ${path.resolve(outputPath)}`);

#!/usr/bin/env node

import utilities from './utilities.js';
import woff from './woff2sfnt.js';
import fs from 'fs-extra';
import yargs from 'yargs';
import path from 'path';
import pkg from '../package.json';
import puppeteer from 'puppeteer';
import isUrl from 'is-url';
import slug from 'url-slug';
import http from 'http-https';
import { readFile, writeFile } from 'node:fs/promises';

const currentDir = process.cwd();
const OPTIONS = {};
const FORMATS = [ 'ttf', 'otf' ];

const decode = {
    '.woff2': async (input) => {
        const ttf2woff2 = (await import('ttf2woff2')).default;
        return ttf2woff2(input);
    },
    '.woff': async (input) => woff.decode(input)
};

let FONTDIR = null;
const foundFonts = new Set();

function logResp(resp) {
    if ('font' === resp.request().resourceType()) {
        const url = resp.url();
        const name = path.basename(url);
        foundFonts.add({
            url,
            name
        });
    }
}

async function convert(name, format) {
    if (!FORMATS.includes(format)) {
        return;
    }
    const ext = path.extname(name);
    const file = `${FONTDIR}/${name}`;

    const input = fs.readFileSync(file);
    const output = file.replace(ext, `.${format}`);

    const decoder = decode[ ext ];

    if (decoder) {
        try {
            const decoded = await decoder(input);
            fs.writeFileSync(output, decoded);
            fs.unlinkSync(file);
            utilities.o('log', `Converted to ${format}`.green);
        } catch (err) {
            utilities.o('log', `Error converting ${name}: ${err.message}`.red.bold);
        }
    } else {
        utilities.o('log', `No decoder found for ${ext}`.red);
    }
}

function downloadFonts({ name, url }) {
    const file = fs.createWriteStream(`${FONTDIR}/${name}`);

    const request = http.get(url);

    request.on('response', response => {
        response.pipe(file);
    });

    file.on('finish', () => {
        file.close(() => {
            utilities.o('log', `✔ ${name}`.green);
        });

        if (OPTIONS.convert) {
            convert(name, OPTIONS.convert);
        }
    });

    file.on('error', (err) => {
        utilities.o('log', `Error! ${err}`.red.bold);
        file.end();
    });
}

function listFoundFonts() {
    const size = foundFonts.size;

    if (size === 0) {
        utilities.o('log', `Found no fonts:`.yellow.bold);
    } else {
        const rows = [ ...foundFonts ]
            .map(font => font.name)
            .join('\n');

        utilities.o('log', `Found ${size} fonts:`.bold);
        utilities.o('log', `${rows}`);
        utilities.o('log', `\nDownloading to current directory`.bold, currentDir);

        FONTDIR = path.join(currentDir, `/font-thief-${slug(OPTIONS.site)}`);
        !fs.existsSync(FONTDIR) && fs.mkdirSync(FONTDIR);
        foundFonts.forEach(downloadFonts);
    }
}

function getPage(url) {
    (async () => {
        const browser = await puppeteer.launch({
            ignoreHTTPSErrors: true
        });
        const page = await browser.newPage();

        page.on('response', logResp);

        try {
            const response = await page.goto(url);
            listFoundFonts();
            await browser.close();
        } catch (e) {
            utilities.o('log', `ERROR: ${e.message}`.red.bold);
        }
    })();
}

function run() {
    utilities.title('FONT THIEF');

    if (OPTIONS.site) {
        const url = OPTIONS.site;

        if (!isUrl(url)) {
            utilities.o('log', `Not a valid url: ${url}`.red.bold);
            return;
        }
        getPage(url);
    } else {
        utilities.o('log', `Url not provided.`.red.bold);
    }

    utilities.exitGraceful();
}

function getOptions() {
    let argv = yargs
        .version(pkg.version)
        .usage(`Usage: $0 -s [url]`)
        .option('convert', {
            alias: [ 'c' ],
            description: 'Convert fonts to format. Currently supported: ' + FORMATS.join(', '),
            type: 'string',
            default: 'otf'
        })
        .option('site', {
            alias: [ 's' ],
            description: 'Site to loot',
            type: 'string',
            demand: true,
        })
        .alias('h', 'help')
        .help('h', 'Show help.')
        .argv;

    OPTIONS.directory = fs.realpathSync(__dirname);
    OPTIONS.site = argv.site;
    OPTIONS.convert = argv.convert;

    run();
}

getOptions();

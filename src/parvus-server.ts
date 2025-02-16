﻿import {Server, IncomingMessage, ServerResponse} from 'http';
import {promises as fs, Stats} from 'fs';
import * as path from 'path';
import {Server as Socket} from 'socket.io';
import {JSDOM} from 'jsdom';
import {generateNext, Middleware, Stack} from './middleware';

export interface MimeType { type: string, name: string, extensions: string[] }

export interface Config {
    host?: string;
    port?: number;
    subfolder?: string;
    middlewares?: Stack[];
    directory?: string;
    additionalMimeTypes?: MimeType[];
}

export class ParvusServer {
    server: Server;
    mimeTypes: MimeType[];
    io: Socket;

    private connectedBefore = false;
    private readonly host: string;
    private readonly port: number;
    private readonly directory: string;
    private readonly subfolder: string;
    private middlewares: Stack[] = [];

    constructor(config?: Config) {
        if (config) {
            this.host = config.host || 'localhost';
            this.port = config.port || 62295;
            this.directory = config.directory || 'site';
            this.subfolder = config.subfolder;
            config.middlewares?.forEach(x => this.addMiddleware(x.middleware, x.route));
            this.mimeTypes = config.additionalMimeTypes || [];
        }
    }

    // noinspection JSUnusedGlobalSymbols
    async startAsync() {
        const mimeTypes = await ParvusServer.fetchMimetypes();

        this.mimeTypes = this.mergedMimeTypes(mimeTypes);
        this.createServer();
    }

    // noinspection JSUnusedGlobalSymbols
    stop() {
        this.server?.close();
    }

    // noinspection JSUnusedGlobalSymbols
    refreshBrowser() {
        console.log('Asking browser to refresh')
        this.io.emit('refresh');
    }

    // noinspection JSUnusedGlobalSymbols
    addMiddleware(middleware: Middleware, route = '*') {
        const stringToRegex = (s) => {
            const matches = s.match(/^([\/~@;%#'])(.*?)\1([gimsuy]*)$/);
            return matches ?
                new RegExp(matches[2], matches[3].split('').filter((i, p, k) => k.indexOf(i) === p).join('')) :
                new RegExp(s);
        }
        let pattern = /[\s\S]*/;
        if (route !== '*') pattern = stringToRegex(route);
        this.middlewares.push({pattern, middleware});
    }

    private mergedMimeTypes(mimeTypes: MimeType[]) {
        return mimeTypes.map(item1 => {
            const item2 = this.mimeTypes.find(item => item.type === item1.type);
            if (item2) {
                return {...item1, extensions: [...item1.extensions, ...item2.extensions]}
            }
            return item1;
        });
    }

    private static async fetchMimetypes() : Promise<MimeType[]> {
        const file = await fs.readFile(`${__dirname}/mime-types.json`, 'utf8');
        return JSON.parse(file as any);
    }

    private createServer() {
        this.server = new Server(async (req: IncomingMessage, res: ServerResponse) => {
            const next = generateNext();
            const matching = this.middlewares?.filter(x => x.pattern.test(req.url)).map(x => x.middleware);

            for (let middleware of matching) {
                next.reset();

                await middleware(req, res, next).catch(console.error);

                if (next.status() === false) {
                    break;
                }
            }

            if (matching.length === 0 || next.status()) {
                await this.defaultHandler(req, res);
            }
        });

        this.server.listen(this.port, this.host, () => {
            // noinspection HttpUrlsUsage
            console.log(`Server is running on http://${this.host}:${this.port}`);
        });

        this.io = new Socket(this.server);

        this.io.on('connection', (socket) => {
            if (!this.connectedBefore) {
                this.refreshBrowser();
                this.connectedBefore = true;
                return;
            }
            console.log('The browser is listening');

            socket.on('disconnect', () => {
                console.log('The browser disconnected');
            });
        });
    }

    async defaultHandler(req: IncomingMessage, res: ServerResponse, directory?: string, addSocket = true) {
        let url = new URL(req.url, 'https://z').pathname;
        if (url.endsWith('/')) url += 'index.html';

        directory = directory || this.directory;
        if (this.subfolder) {
            directory = directory.replace(this.subfolder, '');
            url = url.replace(this.subfolder, '');
        }

        try {
            const filePath = path.join(directory, url);
            let fileExists: Stats = null;

            try {
                fileExists = await fs.stat(filePath);
            } catch {
            }

            if (!fileExists) {
                res.statusCode = 404;
                res.setHeader('Content-Type', 'text/html');
                res.end(`
            <html lang="en">
              <body style="background-color: #171717;color:white;">
                <h3>Page not found</h3>
              </body>
            </html>`)
                return;
            }

            let file = await fs.readFile(filePath);
            const extension = path.extname(url).replace('.', '');
            let mimeType = this.mimeTypes.find(x => x.extensions.includes(extension))?.type;
            if (!mimeType) {
                mimeType = 'text/html';
                console.warn(`Couldn't determine mimetype for ${path.extname(url)}. Defaulting to html`)
            }

            const complete = (input) => {
                res.setHeader('Content-Type', mimeType);
                res.writeHead(200);
                res.end(input);
            }

            //inject socket connection
            if (mimeType === 'text/html' && addSocket) {
                try {
                    let modified = ParvusServer.socketInjection(file.toString());
                    complete(modified);
                    return;
                } catch {
                }
            }

            complete(file);
        } catch (ex) {
            console.error(ex);
            res.setHeader('Content-Type', 'text/html');
            res.writeHead(500);
            res.end(`<html lang="en"><body style="background-color: #171717;color:white;"><h1>Error</h1><p>Failed to load requested file at ${url}</p><p><pre>${ex}</pre></p></body></html>`);
        }
    }

    private static socketInjection(html: string): string {
        const dom = new JSDOM(html),
            document = dom.window.document;
        const body = document.querySelector('body');
        let script = document.createElement('script');
        script.src = '/socket.io/socket.io.js';
        script.type = 'text/javascript';

        body.appendChild(script);

        script = document.createElement('script');
        script.type = 'text/javascript';
        script.text = `const socket = io();socket.on('refresh', () => document.location.reload());`;

        body.appendChild(script);

        return dom.serialize();
    }
}

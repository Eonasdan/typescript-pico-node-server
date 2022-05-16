import {PicoServer} from "../dist/server";

/**
 * This is an example of how you could use the server.
 */

class Startup {

    async do() {

        const pico = new PicoServer({
            middlewares: [
                {
                    middleware: async (req, res, _) => {
                        res.setHeader('Content-Type', 'text/html');
                        res.writeHead(200);
                        res.end(`<html lang="en"><body>from config. ${req.url}</body></html>`);
                    },
                    route: '/config'
                }
            ]
        });

        pico.addMiddleware(async (_, res, next) => {
            await this.testAsync()
            res.setHeader('authorization', 'yo');
            next()
        }, '*');

        pico.addMiddleware(async (__, res, _) => {
            res.setHeader('Content-Type', 'text/html');
            res.writeHead(500);
            res.end(`<html lang="en"><body><h1>Error</h1>from middleware</body></html>`);
        }, '/mw');

        await pico.startAsync();

        setTimeout(() => {
            pico.refreshBrowser();
        }, 5000)
    }

    async testAsync() {
        // do something interesting here
    }
}

const s = new Startup();
s.do().then();

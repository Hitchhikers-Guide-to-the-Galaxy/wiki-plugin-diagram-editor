# wiki-plugin-diagram-editor

A [Federated Wiki](http://fed.wiki.org) **tool page** that edits the diagram
item beside it in the lineup. It resolves its subject via `plugin.consumes`
and the click recorder from
[`@fortyfoxes/wiki-toolcontext`](https://www.npmjs.com/package/@fortyfoxes/wiki-toolcontext),
redraws the diagram source live as you type, and saves back to the source
page — with an explicit read-only fallback when you are not signed in.

Companion to [`wiki-plugin-diagram`](https://github.com/Hitchhikers-Guide-to-the-Galaxy/wiki-plugin-diagram),
whose items it edits.

## Install

```bash
npm install wiki-plugin-diagram-editor
```

Restart the wiki server so the factory and the bundled about page register.

## Use

Put a `diagram-editor` item on an **Edit Diagram** page, then follow an
`[[Edit Diagram]]` link from beside any diagram item. The editor binds to the
diagram that summoned it.

## Develop

```bash
npm install
npm test        # builds, then runs node --test
```

The client bundle is built by esbuild into `client/` (rebuilt automatically
on publish by `prepublishOnly`).

## License

MIT © David Bovill

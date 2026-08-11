(function installMarkdownRenderer(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('markdown-it'));
  } else {
    root.createClippyMarkdown = factory(root.markdownit);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, (MarkdownIt) => {
  return function createClippyMarkdown() {
    if (typeof MarkdownIt !== 'function') throw new Error('Markdown renderer failed to load.');

    const markdown = MarkdownIt({
      html: false,
      breaks: true,
      linkify: true,
      typographer: true,
    });
    const defaultValidateLink = markdown.validateLink.bind(markdown);
    const defaultLinkOpen = markdown.renderer.rules.link_open
      || ((tokens, index, options, _environment, renderer) => renderer.renderToken(tokens, index, options));

    markdown.validateLink = (url) => {
      if (!defaultValidateLink(url)) return false;
      try {
        const protocol = new URL(url).protocol;
        return protocol === 'https:' || protocol === 'http:';
      } catch {
        return false;
      }
    };
    markdown.renderer.rules.link_open = (tokens, index, options, environment, renderer) => {
      tokens[index].attrSet('target', '_blank');
      tokens[index].attrSet('rel', 'noopener noreferrer');
      return defaultLinkOpen(tokens, index, options, environment, renderer);
    };

    return markdown;
  };
}));

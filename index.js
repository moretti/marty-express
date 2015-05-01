var _ = require('lodash');
var Router = require('react-router');
var ServerCookies = require('./serverCookies');

var HEADERS_TO_IGNORE = [
  'accept',
  'accept-encoding',
  'host',
  'connection'
];

module.exports = function (options) {
  options = options || {};

  if (!options.routes) {
    throw new Error('routes is required');
  }

  var Marty = options.marty || require('marty');

  Marty.CookieStateSource.setCookieFactory(function (context) {
    return new ServerCookies(context.req, context.res);
  });

  Marty.LocationStateSource.setLocationFactory(function (context) {
    return _.pick(context.req, 'url', 'protocol', 'query', 'path', 'hostname');
  });

  Marty.HttpStateSource.addHook({
    priority: 0.00000000001,
    before: function (req) {
      var context = this.context;

      if (!context || !context.req) {
        return;
      }

      // Don't change fully qualified urls
      if (!/^https?:\/\//.test(req.url)) {
        req.url = getBaseUrl(context.req) + req.url;
      }

      // Add all headers from original request
      _.extend(req.headers, headers());

      function getBaseUrl(req) {
        return req.protocol + '://' + req.get('host');
      }

      function headers() {
        return _.omit(context.req.headers, HEADERS_TO_IGNORE);
      }
    }
  });

  return function (req, res, next) {
    var router = Router.create({
      location: req.url,
      routes: options.routes,
      onAbort: onAbort
    });

    if (!router.match(req.url)) {
      return next();
    }

    router.run(function (Handler, state) {
      var context = Marty.createContext({ req: req, res: res });

      var renderOptions = {
        type: Handler,
        context: context,
        props: state.params,
        timeout: options.timeout
      };

      Marty
        .renderToString(renderOptions)
        .then(onRendered)
        .catch(onFailedToRender);

      function onRendered(renderResult) {
        var locals = {};
        var html = renderResult.html;
        locals[options.local || 'body'] = html;
        res.render(options.view || 'index', locals);

        if (_.isFunction(options.rendered)) {
          options.rendered(_.extend({
            req: req
          }, renderResult));
        }
      }

      function onFailedToRender(error) {
        if (_.isFunction(options.error)) {
          options.error(req, res, next, error);
        } else {
          console.error('Failed to render ' + req.url, error.stack);
          res.sendStatus(500).end();
        }
      }
    });

    function onAbort(abortReason) {
      if (abortReason.constructor.name === 'Redirect') {
        return res.redirect(302, router.makePath(abortReason.to, abortReason.params, abortReason.query));
      }
    }
  };
};

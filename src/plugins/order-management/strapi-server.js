module.exports = {
  register({ strapi }) {
    // Any initialization logic here
  },
  bootstrap({ strapi }) {
    // Any bootstrap logic here
  },
  controllers: require('./server/controllers'),
  routes: require('./server/routes'),
};

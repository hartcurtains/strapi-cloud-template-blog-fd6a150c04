module.exports = {
  register({ strapi }) {
    // Any initialization logic here
  },
  bootstrap({ strapi }) {
    // Any bootstrap logic here
  },
  controllers: require('./server/controllers'),
  services: require('./server/services'),
  routes: require('./server/routes'),
};

// 'use strict';
// require('newrelic');

// const express = require('express');

// exports.config = {
//   app_name: ['AI Chatbot'],
//   license_key: '0701659266baa8b966a664ebb8ace3821eceNRAL',
//   logging: {
//     level: 'info'
//   }
// };

'use strict'

exports.config = {
  app_name: [process.env.NEW_RELIC_APP_NAME || 'MERN Chatbot'],
  license_key: process.env.NEW_RELIC_LICENSE_KEY || "d89667fd855aca0fc3a40478aee0fe96e94fNRAL",

  logging: {
    level: 'info'
  },

  distributed_tracing: {
    enabled: true
  }
}
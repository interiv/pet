const achievements = require('../scripts/achievementData');

exports.seed = async function (knex) {
  await knex('achievements').del();
  await knex('achievements').insert(achievements);
};

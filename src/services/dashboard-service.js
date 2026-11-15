'use strict';

const { todayInTimeZone } = require('../lib/dates');

/**
 * The dashboard figures. Each method takes an already validated { from, to }.
 * @param {object} deps
 * @param {ReturnType<import('../db/repositories/dashboard-repository').createDashboardRepository>} deps.dashboardRepository
 * @param {string} deps.timeZone  the office time zone, for "today"
 */
function createDashboardService({ dashboardRepository, timeZone }) {
  return {
    stats: (range) => dashboardRepository.stats({ ...range, today: todayInTimeZone(timeZone) }),
    companiesByMonth: (range) => dashboardRepository.companiesByMonth(range),
    outreachByMonth: (range) => dashboardRepository.outreachByMonth(range),
    companiesBySector: (range) => dashboardRepository.companiesBySector(range),
    recruitmentByMajor: (range) => dashboardRepository.recruitmentByMajor(range),
    eventAttendance: (range) => dashboardRepository.eventAttendance(range),
    topEngaged: (range) => dashboardRepository.topEngaged(range),
    hiringTrends: (range) => dashboardRepository.hiringTrends(range),
  };
}

module.exports = { createDashboardService };

#!/usr/bin/node

import csv from 'csvtojson';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { parse } from 'node-html-parser';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import uniq from 'lodash/uniq.js';
import * as dotenv from 'dotenv';
import ora from 'ora';

import creds from './google-creds.json' assert { type: 'json' };

dotenv.config();
dayjs.extend(customParseFormat);

const DEBUG = true;
const { GDOC_ID, VMS_COOKIE } = process.env;

const SUP_CREW_QUESTIONS = {
  SHIFT_RANK_12_7: '12pm - 7pm is my ___________ choice for shift time.',
  SHIFT_RANK_5_12: '5pm - 12am is my ___________ choice for shift time.',
  SHIFT_RANK_7_3: '7pm - 3am is my ___________ choice for shift time.',
  SHIFT_RANK_8_2: '8am - 2pm is my ___________ choice for shift time.',
  DATES:
    'Film Crew shifts begin on Saturday, July 30th and wrap up on Monday, August 8th. In addition the the availability you already provided, can you volunteer on any of the following dates?',
  RETURNING: 'Have you volunteered for Film Crew at Pickathon before?',
  HISTORY:
    'If yes, how many years have you volunteered with Film Crew and which jobs have you done?',
  EXPERIENCE: 'Tell us about any relevant experience you have for this crew.',
};

const PRO_CREW_QUESTIONS = {
  SHIFT_RANK_12_7: '12pm - 7pm is my ___________ choice for shift time.',
  SHIFT_RANK_5_12: '5pm - 12am is my ___________ choice for shift time.',
  SHIFT_RANK_7_3: '7pm - 3am is my ___________ choice for shift time.',
  SHIFT_RANK_8_2: '8am - 2pm is my ___________ choice for shift time.',
  RETURNING:
    'Have you volunteered for the Film Professional Crew at Pickathon before?',
  HISTORY:
    'If yes, how many years have you volunteered with the Film Professional Crew? (approximate answers are ok!) What jobs did you do?',
  DATES:
    'Film Crew shifts begin on Saturday, July 30th and wrap up on Monday August, 8th. Can you be available for any of the following dates?',
  INTERESTS:
    'Which volunteer area(s) are you most interested in? (Check all that apply.)',
  SKILL: 'What would you consider your skill level?',
  EXPERIENCE: 'Briefly tell us about your film experience.',
  PORTFOLIO:
    'Please provide us with a link to an online portfolio or a work sample, if applicable.',
};

const APPLICATION_COLUMNS = {
  FIRST_NAME: 'First Name',
  LAST_NAME: 'Last Name',
  EMAIL: 'Email Address',
  PHONE: 'Phone Number',
  RANK: 'Rank',
  CREW: 'Crew',
  FRIENDS: 'Friends',
  LOCAL_OOT: 'Local or OOT?',
  STATUS: 'Status',
  SHIRT_SIZE: 'Shirt size',
};

const hasProQuestions = (crewQuestions) => {
  return Object.keys(crewQuestions).includes(PRO_CREW_QUESTIONS.PORTFOLIO);
};

const textIsEqual = (text1 = '', text2 = '') =>
  text1.trim().toUpperCase() === text2.trim().toUpperCase();

const phoneIsEqual = (text1 = '', text2 = '') =>
  textIsEqual(text1.replaceAll(/\D/g, ''), text2.replaceAll(/\D/g, ''));

// eslint-disable-next-line no-undef
const pickathonHeaders = new Headers();
pickathonHeaders.append('Cookie', VMS_COOKIE);

const fetchAppsCsv = () => {
  const requestOptions = {
    method: 'GET',
    headers: pickathonHeaders,
    redirect: 'follow',
  };

  return fetch(
    'https://volunteer.pickathon.com/admin/?entity=CrewApplication&action=export',
    requestOptions,
  );
};

const fetchAppDetail = (id) => {
  const requestOptions = {
    method: 'GET',
    headers: pickathonHeaders,
    redirect: 'follow',
  };
  return fetch(
    `https://volunteer.pickathon.com/admin/?entity=CrewApplication&action=show&id=${id}`,
    requestOptions,
  );
};

const getAppsJson = async () => {
  const response = await fetchAppsCsv();
  const csvText = await response.text();
  return csv().fromString(csvText);
};

const getAppId = (app) => {
  const { FIRST_NAME, LAST_NAME, EMAIL, PHONE } = APPLICATION_COLUMNS;
  return `${app[FIRST_NAME]} ${app[LAST_NAME]} - ${app[EMAIL]} - ${app[PHONE]}`;
};

const getCrewRank = (app) => ({
  [app[APPLICATION_COLUMNS.RANK]]: app[APPLICATION_COLUMNS.CREW],
});

const isNew = (crewQuestions) => {
  return hasProQuestions(crewQuestions)
    ? crewQuestions[PRO_CREW_QUESTIONS.RETURNING] !== 'Yes'
    : crewQuestions[SUP_CREW_QUESTIONS.RETURNING] !== 'Yes';
};

const formatNotes = (app, crewQuestions) => {
  const crews = Object.entries(app[APPLICATION_COLUMNS.CREW])
    .sort((a, b) => a[0] - b[0])
    .map((p) => crewShortnames[p[1]]);

  const tags = [isNew(crewQuestions) ? 'NEW' : null, ...crews]
    .filter((a) => a)
    .join(' - ');
  const formatAnswer = (label, question) =>
    crewQuestions[question] ? `* ${label}: ${crewQuestions[question]}` : '';
  if (hasProQuestions(crewQuestions)) {
    return [
      tags,
      formatAnswer('Previous', PRO_CREW_QUESTIONS.HISTORY),
      formatAnswer('Skill', PRO_CREW_QUESTIONS.SKILL),
      formatAnswer('Experience', PRO_CREW_QUESTIONS.EXPERIENCE),
      formatAnswer('Portfolio', PRO_CREW_QUESTIONS.PORTFOLIO),
      formatAnswer('Interests', PRO_CREW_QUESTIONS.INTERESTS),
    ]
      .filter((a) => a)
      .join('\n');
  } else {
    return [
      tags,
      formatAnswer('Previous', SUP_CREW_QUESTIONS.HISTORY),
      formatAnswer('Experience', SUP_CREW_QUESTIONS.EXPERIENCE),
    ]
      .filter((a) => a)
      .join('\n');
  }
};

const compareDayJs = (a, b) => {
  if (a.isAfter(b)) {
    return 1;
  } else if (b.isAfter(a)) {
    return -1;
  } else {
    return 0;
  }
};

const formatDates = (days) =>
  uniq(
    [...days]
      .map((day) => {
        // eslint-disable-next-line no-unused-vars
        const [_, _weekday, month, date] =
          [...day.matchAll(/(\w+)\W+(\w+)\W+(\d+)/g)]?.[0] ?? [];
        const dayJsdate = dayjs(`${month}-${date}-2022`, 'MMMM-D-YYYY');
        if (!dayJsdate.isValid()) {
          console.warn(`Invalid Date: ${day}`);
        }
        return dayJsdate;
      })
      .sort(compareDayJs)
      .map((d) => d.format('ddd M/D')),
  ).join(', ');

const formatShifts = (crewQuestions) => {
  const questions = hasProQuestions(crewQuestions)
    ? PRO_CREW_QUESTIONS
    : SUP_CREW_QUESTIONS;
  const am = crewQuestions[questions.SHIFT_RANK_8_2];
  const pm = crewQuestions[questions.SHIFT_RANK_12_7];
  const evening = crewQuestions[questions.SHIFT_RANK_5_12];
  const lateNight = crewQuestions[questions.SHIFT_RANK_7_3];
  return [
    { rank: parseInt(am), label: 'am' },
    { rank: parseInt(pm), label: 'pm' },
    { rank: parseInt(evening), label: 'evening' },
    { rank: parseInt(lateNight), label: 'late night' },
  ]
    .sort((a, b) => a.rank - b.rank)
    .map((s) => s.label)
    .join(', ');
};

const formatAvailability = (app, crewQuestions) => {
  const questions = hasProQuestions(crewQuestions)
    ? PRO_CREW_QUESTIONS
    : SUP_CREW_QUESTIONS;
  const generalDays = Object.entries(app)
    .filter(([key, value]) => key.startsWith('Days: ') && value === 'TRUE')
    .map(([key]) => key.replace('Days: ', ''));
  const crewDays = crewQuestions[questions.DATES].match(/\w+\W+\w+\W+\d+\w+/g);
  const formattedDays = formatDates([...generalDays, ...crewDays]);

  const formattedShifts = formatShifts(crewQuestions);
  return [formattedDays, formattedShifts].join('\n');
};

const formatReviewNotes = (app, crewQuestions) => {
  const notes = [];
  const isPro = hasProQuestions(crewQuestions);
  if (isNew(crewQuestions)) {
    notes.push('* New');
  }
  if (isPro && !crewQuestions[PRO_CREW_QUESTIONS.PORTFOLIO]) {
    notes.push('* Missing portfolio');
  }
  if (
    isPro
      ? !crewQuestions[PRO_CREW_QUESTIONS.EXPERIENCE]
      : !crewQuestions[SUP_CREW_QUESTIONS.EXPERIENCE]
  ) {
    notes.push('* Missing experience');
  }
  return notes;
};

const createAppRow = (app, existingRow, crewQuestions) => {
  const availability = formatAvailability(app, crewQuestions);
  const notes = formatNotes(app, crewQuestions);
  const cleanedReviewNotes = (
    existingRow?.['For Review (2022)'] || ''
  ).replaceAll(/^\*\s.+\n*/gm, '');
  const reviewNotes = [
    ...formatReviewNotes(app, crewQuestions),
    cleanedReviewNotes,
  ]
    .filter((a) => a)
    .join('\n');

  const {
    FIRST_NAME,
    LAST_NAME,
    EMAIL,
    PHONE,
    FRIENDS,
    LOCAL_OOT,
    STATUS,
    SHIRT_SIZE,
  } = APPLICATION_COLUMNS;

  return {
    VOLUNTEERS: `${app[FIRST_NAME]} ${app[LAST_NAME]}`,
    ['2022 Notes']: notes,
    ['2022 Availability (times in order of preference)']: availability,
    ['2022 Schedule with...']: app[FRIENDS],
    ['2022 Local?']: app[LOCAL_OOT] === 'Local' ? 'Y' : 'N',
    ['2022 Accepted?']: app[STATUS] === 'accepted' ? 'Y' : '',
    ['2022 Status']: app[STATUS],
    ['Shirt Size']: app[SHIRT_SIZE],
    ['EMAIL']: app[EMAIL],
    ['PHONE']: app[PHONE],
    ['For Review (2022)']: reviewNotes,
  };
};

const crewShortnames = {
  ['Film Crew: General Support']: 'SUP',
  ['Film Crew: Professionals']: 'PRO',
};

const loadDoc = async (id) => {
  const doc = new GoogleSpreadsheet(id);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
  console.log(`⬇️  Loaded Doc: ${doc.title}`);
  return doc;
};

const mergeApps = (appsJson) =>
  appsJson.reduce((acc, app) => {
    const appId = getAppId(app);
    const existingApp = acc[appId];
    const newAppBase = Object.values(
      existingApp?.['Crew'] || {},
    )?.[0]?.includes('Professionals')
      ? existingApp
      : app;
    const newApp = {
      ...newAppBase,
      ['Rank']: null,
      ['Crew']: { ...(existingApp?.['Crew'] || {}), ...getCrewRank(app) },
    };
    return {
      ...acc,
      [appId]: newApp,
    };
  }, {});

const wait = (timeout) =>
  new Promise((resolve) => setTimeout(resolve, timeout));

const syncApplication = async (app, rows, sheet) => {
  const spinner = ora(`Syncing ${getAppId(app)}`).start();
  const crewQuestions = await getQuestions(app['ID']);
  const matches = rows.filter(
    (row) =>
      textIsEqual(app[APPLICATION_COLUMNS.EMAIL], row['EMAIL']) ||
      phoneIsEqual(app[APPLICATION_COLUMNS.PHONE], row['PHONE']),
  );
  if (matches.length === 1) {
    const row = matches[0];
    const newRow = createAppRow(app, row, crewQuestions);
    const needsUpdate = Object.entries(newRow).some(([key, value]) => {
      return (row[key] || false) !== (value || false);
    });
    if (needsUpdate) {
      Object.assign(row, newRow);
      if (!DEBUG) {
        await row.save();
      }
      spinner.succeed(`Updated ${getAppId(app)}`);
    } else {
      spinner.info(`Skipped ${getAppId(app)}`);
    }
  } else if (matches.length > 1) {
    spinner.fail(`Multiple Matches for ${getAppId(app)}`);
  } else {
    spinner.succeed(`Added ${getAppId(app)}`);
    const newRow = createAppRow(app, null, crewQuestions);
    if (!DEBUG) {
      await sheet.addRow(newRow);
    }
  }
};

const handleAppSync = async (app, rows, sheet) => {
  try {
    await syncApplication(app, rows, sheet);
  } catch (e) {
    if (`${e}`.includes('Google API error')) {
      const spinner = ora(
        'Google API quota exceeded. Waiting for refresh...',
      ).start();
      await wait(30000);
      spinner.succeed('Google API quota exceeded');
      await handleAppSync(app, rows, sheet);
    }
  }
};

const getQuestions = async (id) => {
  const res = await fetchAppDetail(id);
  const htmlRes = await res.text();
  const htmlDoc = parse(htmlRes);
  const questions = Object.fromEntries(
    Array.from(htmlDoc.querySelectorAll('.form-control li')).map((e) =>
      e.innerText
        .split('\n')
        .map((qa) => {
          const trimmedText = qa?.trim()?.replaceAll(/\s+/g, ' ');
          return trimmedText === 'Empty' ? null : trimmedText;
        })
        .filter((a) => a),
    ),
  );
  return questions;
};

(async function () {
  const parsedApps = await getAppsJson();

  const doc = await loadDoc(GDOC_ID);
  const sheet = doc.sheetsByIndex[0];
  const rows = await sheet.getRows();

  const mergedApps = mergeApps(parsedApps);

  // const app = Object.entries(mergedApps).find(([name]) =>
  //   name?.includes('Rush'),
  // )[1];
  // await handleAppSync(app, rows, sheet);

  for (const app of Object.values(mergedApps)) {
    await handleAppSync(app, rows, sheet);
  }
  console.log('🎉 DONE!');

  // if (DEBUG) {
  //   // eslint-disable-next-line no-constant-condition, no-empty
  //   while (true) {}
  // }
})();

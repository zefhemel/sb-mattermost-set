import { invokeFunction } from "@silverbulletmd/plugos-silverbullet-syscall/system";
import { readPage } from "@silverbulletmd/plugos-silverbullet-syscall/space";
import Handlebars from "handlebars";

import {
  MattermostUser,
  findUserByName,
  postMessage,
  resetSETTeam,
  updateChannel,
} from "./mattermost";
import { readSecrets } from "@silverbulletmd/plugs/lib/secrets_page";
import { opsGenieScheduleUrl, channelId } from "./constants";

function parseDate(s: string): Date {
  return new Date(
    `${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}`
  );
}

type Schedule = {
  name: string;
  date: Date;
};

type GroupedSchedule = {
  name: string;
  start: Date;
  end: Date;
};

async function pullSchedule(which: string): Promise<GroupedSchedule[]> {
  const [schedules] = await readSecrets(["setOpsGenieTokens"]);
  let r = await fetch(`${opsGenieScheduleUrl}?${schedules[which]}`);
  let text = await r.text();
  let lines = text.split("\n");
  let lastDate, lastOnCall;
  let schedule: Schedule[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line.startsWith("DTSTART;")) {
      lastDate = parseDate(line.split(":")[1].split("T")[0]);
    } else if (line.startsWith("SUMMARY:")) {
      let onCall = line.substring("SUMMARY:".length).split("(")[0].trim();
      schedule.push({ name: onCall, date: lastDate });
    }
  }
  let groupedSchedule: GroupedSchedule[] = [];
  let lastName = schedule[0].name;
  let startDate = schedule[0].date,
    endDate = schedule[0].date;
  for (let s of schedule) {
    if (s.name !== lastName) {
      groupedSchedule.push({ name: lastName, start: startDate, end: endDate });
      startDate = s.date;
      lastName = s.name;
    }
    endDate = s.date;
  }
  groupedSchedule.push({ name: lastName, start: startDate, end: endDate });
  return groupedSchedule;
}

type ScheduleObj = {
  date: string;
  lead: MattermostUser;
  primary: MattermostUser[];
  backup: MattermostUser[];
};

async function getScheduleForDate(d = new Date()) {
  let [lead, primary, backup] = await Promise.all([
    pullSchedule("lead"),
    pullSchedule("primary"),
    pullSchedule("backup"),
  ]);
  let firstDayOfWeek = new Date(d.setDate(d.getDate() - d.getDay() + 1));
  let scheduleObj: ScheduleObj = {
    date: firstDayOfWeek.toISOString().split("T")[0],
    lead: await findUserByName(findActive(lead, d)[0].name),
    primary: [],
    backup: [],
  };

  for (let { name } of findActive(primary, d)) {
    scheduleObj.primary.push(await findUserByName(name));
  }
  for (let { name } of findActive(backup, d)) {
    scheduleObj.backup.push(await findUserByName(name));
  }
  return scheduleObj;
}

// @ts-ignore
import scheduleTemplate from "./templates/message-template.txt";

export async function postOnCall() {
  try {
    let template = Handlebars.compile(scheduleTemplate, { noEscape: true });
    let schedule = await getScheduleForDate(new Date());
    let rendered = template(schedule);
    await postMessage(rendered);
    await resetSETTeam([
      schedule.lead.id,
      ...schedule.primary.map((user) => user.id),
      ...schedule.backup.map((user) => user.id),
    ]);
    await updateChannelHeader(schedule);
  } catch (e) {
    console.error("Error", e);
    throw e;
  }
}

// @ts-ignore
import nextWeekTemplate from "./templates/next-week-template.txt";

export async function postOnCallNextWeek() {
  try {
    let nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    let template = Handlebars.compile(nextWeekTemplate, { noEscape: true });
    let schedule = await getScheduleForDate(nextWeek);
    let rendered = template(schedule);
    //console.log("Rendered", rendered);
    await postMessage(rendered);
  } catch (e) {
    console.error("Error", e);
    throw e;
  }
}

// @ts-ignore
import headerTemplate from "./templates/header.txt";

async function updateChannelHeader(schedule) {
  // let { text } = await readPage(headerTemplatePage);
  let template = Handlebars.compile(headerTemplate, { noEscape: true });
  let rendered = template(schedule);
  console.log("Updating channel header", channelId, rendered);
  console.log("Response", await updateChannel(channelId, { header: rendered }));
}

function findActive(
  schedules: GroupedSchedule[],
  date: Date
): GroupedSchedule[] {
  let active: GroupedSchedule[] = [];
  for (let schedule of schedules) {
    if (schedule.start <= date && date <= schedule.end) {
      active.push(schedule);
    }
  }
  return active;
}

export function postOnCallNextWeekCommand() {
  return invokeFunction("server", "postOnCallNextWeek");
}

export function postOnCallCommand() {
  console.log("POSTing on call");
  return invokeFunction("server", "postOnCall");
}

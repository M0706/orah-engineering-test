import { NextFunction, Request, Response } from "express"
import { getRepository, MoreThan, In } from "typeorm"
import { GroupStudent } from "../entity/group-student.entity"
import { Group } from "../entity/group.entity"
import { Roll } from "../entity/roll.entity"
import { StudentRollState } from "../entity/student-roll-state.entity"
import { CreateGroupStudentInput } from "../interface/group-student.interface"
import { CreateGroupInput, UpdateGroupInput } from "../interface/group.interface"
import { ltmtSymbols } from "../utils/enum"
import { getGroupInput, getupdateGroupInput } from "./helpers"

export class GroupController {
  private groupRepository = getRepository(Group)
  private studentGroupRepository = getRepository(GroupStudent)
  private studentRollStateRepository = getRepository(StudentRollState)
  private rollRepository = getRepository(Roll)

  async allGroups(next: NextFunction) {
    try {
      return await this.groupRepository.find()
    } catch (error) {
      return error
    }
  }

  async createGroup(request: Request, next: NextFunction) {
    try {
      const { body: params } = request

      const createGroupInput: CreateGroupInput = getGroupInput(params)

      const group = new Group()
      group.prepareToCreate(createGroupInput)

      return await this.groupRepository.save(group)
    } catch (error) {
      return error
    }
  }

  async updateGroup(request: Request, next: NextFunction) {
    try {
      const { body: params } = request
      const group = await this.groupRepository.findOne(params.id)

      if (!group) {
        throw new Error("Group not found")
      }

      const updategroupinput: UpdateGroupInput = getupdateGroupInput(params, group)

      group.prepareToUpdate(updategroupinput)
      return await this.groupRepository.save(group)
    } catch (error) {
      return error
    }
  }

  async removeGroup(request: Request, next: NextFunction) {
    try {
      const { body: params } = request
      const group = await this.groupRepository.findOne(params.id)

      if (!group) {
        throw new Error("Group not found")
      }

      return await this.groupRepository.remove(group)
    } catch (error) {
      return error
    }
  }

  async getGroupStudents(request: Request, response: Response, next: NextFunction) {
    try {
      // Task 1:
      // Return the list of Students that are in a Group
      const { body: params } = request
      const group = await this.groupRepository.findOne(params.id)
      if (!group) {
        throw new Error("Group not found")
      }
      return await this.get_student_group_mapping(group)
    } catch (error) {
      return error
    }
  }

  async runGroupFilters(next: NextFunction) {
    try {
      // 1. Clear out the groups (delete all the students from the groups)
      await this.studentGroupRepository.clear();

      // 2. For each group, query the student rolls to see which students match the filter for the group
      const groups = await this.groupRepository.find();
      const promises = groups.map(async (group) => {
        const studentrollmapping = await this.get_student_group_mapping(group);
        // 3. Add the list of students that match the filter to the group
        const student_counts = await this.pushstudentgroupmapping_to_db(studentrollmapping, group);
        await this.update_group_info_in_db(group, student_counts)
      });

      await Promise.all(promises);
      return await this.studentGroupRepository.find();
    } catch (error) {
      return error;
    }
  }

  private async get_student_group_mapping(group: Group) {
    const { number_of_weeks } = group
    const fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - number_of_weeks * 7)

    const filtered_rolls = await this.rollRepository.find({
      where: {
        completed_at: MoreThan(fromDate),
      },
    })

    const rollIds = filtered_rolls.map((roll) => roll.id)
    const studentrollmapping = await this.studentRollStateRepository.find({
      where: {
        roll_id: In(rollIds),
        state: In(group.roll_states.split(",")),
      },
    })

    return studentrollmapping
  }

  private async pushstudentgroupmapping_to_db(studentrollmapping: any[], group: Group) {
    const studentCounts = studentrollmapping.reduce((counts, stdgrpmap) => {
      const studentId = stdgrpmap.student_id;
      counts[studentId] = (counts[studentId] || 0) + 1;
      return counts;
    }, {});

    const updatePromises = Object.entries(studentCounts).map(([key, value]) => {
      if (
        (group.ltmt === ltmtSymbols.GREATER_THAN && group.incidents < value) ||
        (group.ltmt === ltmtSymbols.LESS_THAN && group.incidents > value)
      ) {
        return this.pushtoStudentGroupHelper(Number(key), group.id, Number(value));
      }
      return Promise.resolve();
    });

    await Promise.all(updatePromises);
    return Object.keys(studentCounts).length;
  }

  private async pushtoStudentGroupHelper(student_id: number, group_id: number, count: number) {
    const createGroupStudentInput: CreateGroupStudentInput = {
      student_id: student_id,
      group_id: group_id,
      incident_count: count
    }
    const groupstudent = new GroupStudent()
    groupstudent.prepareToCreate(createGroupStudentInput)
    await this.studentGroupRepository.save(groupstudent)
  }

  private async update_group_info_in_db(group: Group, student_counts: number) {
    const updategroupinput: UpdateGroupInput = group
    group["run_at"] = new Date()
    group["student_count"] = student_counts
    group.prepareToUpdate(updategroupinput)
    await this.groupRepository.save(group)
  }
}



